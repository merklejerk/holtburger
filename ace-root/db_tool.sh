#!/bin/bash
set -e

# Load environment variables
if [ -f "docker.env" ]; then
    export $(grep -v '^#' docker.env | xargs)
else
    echo "Error: docker.env not found."
    exit 1
fi

CONTAINER_NAME="ace-holtburger-db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

usage() {
    echo "Usage: $0 {backup [file]|restore [file]|shell}"
    exit 1
}

shell() {
    echo "Connecting to MariaDB client..."
    docker exec -it "$CONTAINER_NAME" /usr/bin/mysql -u root --password="$MYSQL_ROOT_PASSWORD"
}

backup() {
    local file=$1
    if [ -z "$file" ]; then
        file="ace_backup_${TIMESTAMP}.sql"
    fi

    echo "Starting backup to $file..."
    
    # We dump all three ACE databases
    docker exec "$CONTAINER_NAME" /usr/bin/mysqldump -u root --password="$MYSQL_ROOT_PASSWORD" \
        --databases "$ACE_SQL_AUTH_DATABASE_NAME" "$ACE_SQL_SHARD_DATABASE_NAME" "$ACE_SQL_WORLD_DATABASE_NAME" \
        > "$file"
    
    echo "Backup completed successfully: $file"
}

restore() {
    local file=$1
    if [ -z "$file" ]; then
        echo "Error: Must provide a file to restore from."
        usage
    fi

    if [ ! -f "$file" ]; then
        echo "Error: Backup file '$file' not found."
        exit 1
    fi

    echo "Restoring from $file..."
    echo "WARNING: This will overwrite existing data in $ACE_SQL_AUTH_DATABASE_NAME, $ACE_SQL_SHARD_DATABASE_NAME, and $ACE_SQL_WORLD_DATABASE_NAME."
    read -p "Are you sure? (y/N) " confirm
    if [[ $confirm != [yY] ]]; then
        echo "Restore cancelled."
        exit 0
    fi

    # Feed the SQL file into the mysql client in the container
    cat "$file" | docker exec -i "$CONTAINER_NAME" /usr/bin/mysql -u root --password="$MYSQL_ROOT_PASSWORD"

    echo "Restore completed successfully."
}

case "$1" in
    backup)
        backup "$2"
        ;;
    restore)
        restore "$2"
        ;;
    shell)
        shell
        ;;
    *)
        usage
        ;;
esac
