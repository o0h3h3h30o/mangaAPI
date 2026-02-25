/**
 * Hetzner Object Storage (S3-compatible) client
 */
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    region: 'eu-central-1',
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

module.exports = { s3, uploadToS3, existsOnS3, BUCKET };
