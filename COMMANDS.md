# Crawler & Scripts Commands

## Setup trên server mới

```bash
# CD vào thư mục project
cd /home/www/wwwroot/nodejs/manhwas

# Fix quyền git (chạy bằng root nhưng thư mục thuộc user www)
git config --global --add safe.directory /home/www/wwwroot/nodejs/manhwas

# Init git + kết nối repo (dùng HTTPS vì server không có SSH key)
git init
git remote add origin https://github.com/o0h3h3h30o/mangaAPI.git
git fetch origin
git checkout -b main origin/main

# Install dependencies
npm install

# Copy file .env (sửa DB_HOST, DB_NAME, PROXY_USER, PROXY_PASS...)
cp .env.example .env
vi .env
```

## Pull code mới từ GitHub

```bash
cd /home/www/wwwroot/nodejs/manhwas
git pull
```

## Crawl truyện mới

```bash
# Crawl tất cả sources (default 3 pages)
node crawler/run-crawl.js

# Crawl 1 source cụ thể
node crawler/run-crawl.js --source jestful
node crawler/run-crawl.js --source raw18
node crawler/run-crawl.js --source xtoon365
node crawler/run-crawl.js --source manhwaweb

# Crawl nhiều pages hơn
node crawler/run-crawl.js --source jestful --pages 5

# Custom URL + start page
node crawler/run-crawl.js --source xtoon365 --url https://t1.xtoon365.com/category/theme/302/finish/1
node crawler/run-crawl.js --source xtoon365 --pages 5 --start-page 3

# Dry-run (chỉ parse, không ghi DB)
node crawler/run-crawl.js --dry-run

# Liệt kê parsers
node crawler/run-crawl.js --list
```

## Crawl ảnh chapter

```bash
# Crawl tối đa 50 chapter chưa có ảnh
node crawler/run-crawl-chapters.js

# Giới hạn số chapter
node crawler/run-crawl-chapters.js --limit 100

# Crawl chapter của 1 manga
node crawler/run-crawl-chapters.js --manga-id 42

# Crawl chapter mới nhất trước
node crawler/run-crawl-chapters.js --order newest

# Download ảnh ra local
node crawler/run-crawl-chapters.js --output /path/to/chapter
```

## Re-crawl chapters (đã crawl rồi, crawl lại)

```bash
node crawler/run-recrawl-chapters.js --source xtoon365
node crawler/run-recrawl-chapters.js --source raw18
node crawler/run-recrawl-chapters.js --source xtoon365 --manga-id 42
node crawler/run-recrawl-chapters.js --source xtoon365 --limit 10
```

## Re-crawl covers

```bash
# Mặc định crawl xtoon365
node crawler/run-recrawl-covers.js

# Crawl theo source
node crawler/run-recrawl-covers.js --source jestful
node crawler/run-recrawl-covers.js --source raw18

# Giới hạn + force
node crawler/run-recrawl-covers.js --source jestful --limit 50
node crawler/run-recrawl-covers.js --id 123
node crawler/run-recrawl-covers.js --force
```

## Dịch tên truyện

```bash
# Dịch tất cả chưa dịch
node crawler/run-translate.js

# Giới hạn
node crawler/run-translate.js --limit 50
node crawler/run-translate.js --id 123

# Preview (không ghi DB)
node crawler/run-translate.js --dry-run
```

## Fetch tên tiếng Anh

```bash
node crawler/run-fetch-en-names.js
node crawler/run-fetch-en-names.js --limit 50
node crawler/run-fetch-en-names.js --id 123
node crawler/run-fetch-en-names.js --dry-run
node crawler/run-fetch-en-names.js --force
node crawler/run-fetch-en-names.js --no-translate
```

## Sync thời gian

```bash
node crawler/run-sync-time.js
```

## Upload ảnh lên S3

```bash
# Chỉ upload ảnh chưa migrate
node scripts/migrate-pages-to-s3.js

# Force upload lại tất cả
node scripts/migrate-pages-to-s3.js --force

# Verify S3, chỉ upload thiếu
node scripts/migrate-pages-to-s3.js --verify

# Giới hạn + chỉ 1 chapter
node scripts/migrate-pages-to-s3.js --limit 10000
node scripts/migrate-pages-to-s3.js --chapter-id 123

# Custom concurrency
node scripts/migrate-pages-to-s3.js --concurrency 200

# Chạy từ mới nhất (chạy 2 process: asc + desc)
node scripts/migrate-pages-to-s3.js --direction desc
```

## Cover utils

```bash
# Download covers
node scripts/download-covers.js [--force]

# Generate thumbnails
node scripts/generate-thumbs.js [--force]
```
