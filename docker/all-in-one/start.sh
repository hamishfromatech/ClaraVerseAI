#!/bin/bash
# ============================================
# ClaraVerse All-in-One Startup Script
# ============================================

set -e

echo "============================================"
echo "  ClaraVerse All-in-One Starting..."
echo "============================================"

# ============================================
# Generate encryption keys if not provided
# ============================================
if [ -z "$ENCRYPTION_MASTER_KEY" ]; then
    echo "Generating ENCRYPTION_MASTER_KEY..."
    export ENCRYPTION_MASTER_KEY=$(head -c 32 /dev/urandom | xxd -p -c 32)
    echo "  Key generated (stored in container - use -e to persist)"
fi

if [ -z "$JWT_SECRET" ]; then
    echo "Generating JWT_SECRET..."
    export JWT_SECRET=$(head -c 64 /dev/urandom | xxd -p -c 64)
    echo "  Key generated (stored in container - use -e to persist)"
fi

# ============================================
# Initialize data directories
# ============================================
echo "Initializing data directories..."
mkdir -p /data/mongodb /data/mysql /data/redis /data/uploads /data/logs /data/backend
chown -R mysql:mysql /data/mysql /run/mysqld 2>/dev/null || true

# ============================================
# Initialize MySQL if needed
# ============================================
if [ ! -d "/data/mysql/mysql" ]; then
    echo "Initializing MySQL database..."
    mysqld --initialize-insecure --user=mysql --datadir=/data/mysql

    # Start MySQL temporarily to create user/database
    mysqld --user=mysql --datadir=/data/mysql &
    MYSQL_PID=$!

    # Wait for MySQL to be ready
    for i in {1..30}; do
        if mysqladmin ping -h 127.0.0.1 --silent 2>/dev/null; then
            break
        fi
        sleep 1
    done

    # Create database and user
    mysql -h 127.0.0.1 <<EOF
CREATE DATABASE IF NOT EXISTS claraverse;
CREATE USER IF NOT EXISTS 'claraverse_user'@'%' IDENTIFIED BY 'claraverse_pass';
GRANT ALL PRIVILEGES ON claraverse.* TO 'claraverse_user'@'%';
FLUSH PRIVILEGES;
EOF

    # Run migrations
    echo "Running database migrations..."
    for f in /app/migrations/*.sql; do
        echo "  Running: $(basename $f)"
        mysql -h 127.0.0.1 claraverse < "$f"
    done

    echo "MySQL initialized successfully"

    # Stop temporary MySQL
    kill $MYSQL_PID 2>/dev/null || true
    wait $MYSQL_PID 2>/dev/null || true
fi

# ============================================
# Initialize MongoDB if needed
# ============================================
if [ ! -f "/data/mongodb/WiredTiger" ]; then
    echo "MongoDB will initialize on first start..."
fi

# ============================================
# Update MySQL config for proper operation
# ============================================
cat > /etc/mysql/mysql.conf.d/docker.cnf <<EOF
[mysqld]
datadir=/data/mysql
socket=/run/mysqld/mysqld.sock
bind-address=127.0.0.1
EOF

# ============================================
# Print access information
# ============================================
echo ""
echo "============================================"
echo "  ClaraVerse is starting!"
echo "============================================"
echo ""
echo "  Access: http://localhost"
echo ""
echo "  First Steps:"
echo "    1. Open http://localhost in browser"
echo "    2. Register account (first user = admin)"
echo "    3. Add AI provider keys in Settings"
echo ""
echo "============================================"
echo ""

# ============================================
# Start supervisord (manages all services)
# ============================================
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
