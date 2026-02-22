# Node.js Manga API

A RESTful API built with Node.js and Express for managing manga data with MySQL database.

## Features

- RESTful API endpoints for manga data
- MySQL database connection with connection pooling
- CORS enabled
- Environment-based configuration
- Error handling middleware

## Prerequisites

- Node.js (v14 or higher)
- MySQL Server
- MySQL database named `manga`

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Update the database credentials in `.env` file

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=manga
DB_PORT=3306
PORT=3000
```

## Running the Application

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### Base URL
```
http://localhost:3000
```

### Endpoints

#### Get all manga
```
GET /api/manga
```

#### Get latest manga
```
GET /api/manga/latest?limit=10
```
Query parameters:
- `limit` (optional): Number of results to return (default: 10)

#### Get popular manga by day
```
GET /api/manga/popular/day?limit=10&offset=0
```
Query parameters:
- `limit` (optional): Number of results to return (default: 10)
- `offset` (optional): Number of results to skip (default: 0)

#### Get popular manga by week
```
GET /api/manga/popular/week?limit=10&offset=0
```
Query parameters:
- `limit` (optional): Number of results to return (default: 10)
- `offset` (optional): Number of results to skip (default: 0)

#### Get popular manga by month
```
GET /api/manga/popular/month?limit=10&offset=0
```
Query parameters:
- `limit` (optional): Number of results to return (default: 10)
- `offset` (optional): Number of results to skip (default: 0)

#### Search manga
```
GET /api/manga/search?q=keyword
```
Query parameters:
- `q` (required): Search keyword

#### Get manga by ID
```
GET /api/manga/:id
```

## Project Structure

```
nodejs-manga-api/
├── config/
│   └── database.js       # Database connection configuration
├── controllers/
│   └── manga.controller.js   # Manga business logic
├── routes/
│   └── manga.routes.js   # API route definitions
├── .env                  # Environment variables (not in git)
├── .env.example          # Example environment file
├── .gitignore           # Git ignore rules
├── package.json         # Project dependencies
├── server.js            # Main application entry point
└── README.md            # This file
```

## Database Schema

Make sure your MySQL database has a `manga` table. Example schema:

```sql
CREATE TABLE manga (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  cover_image VARCHAR(255),
  author VARCHAR(255),
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": [...]
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Technologies Used

- **Express.js** - Web framework
- **MySQL2** - MySQL client with promise support
- **dotenv** - Environment variable management
- **cors** - Cross-Origin Resource Sharing
- **nodemon** - Development auto-reload

## License

ISC
