const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth.middleware');

const JWT_EXPIRES_IN = '7d';

/**
 * Map a database user row to the frontend User shape.
 */
function mapUserToResponse(dbUser) {
    const displayName = dbUser.name || dbUser.username;
    return {
        id: dbUser.id,
        uuid: String(dbUser.id),
        name: displayName,
        email: dbUser.email,
        role: dbUser.role || 'user',
        avatar_full_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&size=200`,
        total_points: 0,
        used_points: 0,
        available_points: 0,
        achievements_points: 0,
        created_at: dbUser.created_at ? new Date(dbUser.created_at).toISOString() : new Date().toISOString(),
        updated_at: dbUser.updated_at ? new Date(dbUser.updated_at).toISOString() : new Date().toISOString(),
        pet: null,
        achievement: null,
    };
}

/**
 * Generate JWT token for a user.
 */
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role || 'user' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

// POST /api/auth/login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email/username and password are required'
            });
        }

        // Allow login with email or username
        const [rows] = await db.query(
            'SELECT * FROM users WHERE (email = ? OR username = ?) AND active = 1 LIMIT 1',
            [email, email]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const user = rows[0];

        // bcryptjs handles Laravel's $2y$ prefix automatically
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Update last_login
        await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        const token = generateToken(user);

        res.json({
            user: mapUserToResponse(user),
            token: token,
            token_type: 'Bearer'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'An error occurred during login'
        });
    }
};

// POST /api/auth/register
exports.register = async (req, res) => {
    try {
        const { name, email, password, password_confirmation } = req.body;

        if (!name || !email || !password || !password_confirmation) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }

        if (password !== password_confirmation) {
            return res.status(400).json({
                success: false,
                error: 'Passwords do not match'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters'
            });
        }

        // Check if email already exists
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Email is already registered'
            });
        }

        // Generate username from email
        let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

        // Ensure username is unique
        const [existingUsernames] = await db.query(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [username]
        );
        if (existingUsernames.length > 0) {
            username = username + Date.now().toString().slice(-4);
        }

        // Hash password (bcrypt, 10 rounds - same as Laravel default)
        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            `INSERT INTO users (name, username, email, password, ip_address, created_on, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', UNIX_TIMESTAMP(), 1, NOW(), NOW())`,
            [name, username, email, hashedPassword]
        );

        // Fetch the created user
        const [newUsers] = await db.query(
            'SELECT * FROM users WHERE id = ? LIMIT 1',
            [result.insertId]
        );

        const newUser = newUsers[0];
        const token = generateToken(newUser);

        res.status(201).json({
            user: mapUserToResponse(newUser),
            token: token,
            token_type: 'Bearer'
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred during registration'
        });
    }
};

// POST /api/auth/logout
exports.logout = async (req, res) => {
    try {
        // JWT is stateless — just respond success (client clears token)
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred during logout'
        });
    }
};

// GET /api/auth/profile
exports.getProfile = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM users WHERE id = ? AND active = 1 LIMIT 1',
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json(mapUserToResponse(rows[0]));
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching profile'
        });
    }
};
