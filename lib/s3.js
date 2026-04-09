/**
 * S3-compatible storage clients (Hetzner + MinIO)
 */
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// --------------- Hetzner S3 ---------------

const s3 = new S3Client({
    region: process.env.S3_REGION || 'fsn1',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET;

async function uploadToS3(key, buffer, contentType = 'image/jpeg') {
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
    }));
}

async function existsOnS3(key) {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch {
        return false;
    }
}

// --------------- MinIO ---------------

let _minio = null;
let _minioBucket = null;

function getMinioClient() {
    if (_minio) return { client: _minio, bucket: _minioBucket };

    const endpoint = process.env.MINIO_ENDPOINT;
    if (!endpoint) throw new Error('MINIO_ENDPOINT is not configured');

    _minio = new S3Client({
        region: process.env.MINIO_REGION || 'us-east-1',
        endpoint,
        credentials: {
            accessKeyId: process.env.MINIO_ACCESS_KEY,
            secretAccessKey: process.env.MINIO_SECRET_KEY,
        },
        forcePathStyle: true,
    });
    _minioBucket = process.env.MINIO_BUCKET;

    return { client: _minio, bucket: _minioBucket };
}

async function uploadToMinio(key, buffer, contentType = 'image/jpeg') {
    const { client, bucket } = getMinioClient();
    await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
    }));
}

async function existsOnMinio(key) {
    try {
        const { client, bucket } = getMinioClient();
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    s3, uploadToS3, existsOnS3, BUCKET,
    uploadToMinio, existsOnMinio, getMinioClient,
};
