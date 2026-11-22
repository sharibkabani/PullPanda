#!/bin/sh
# Empties the bench database and queue between runs.
PGPASSWORD=pullpanda psql -q -h localhost -U pullpanda -d pullpanda_bench -c 'truncate users, installations, repositories, reviews, user_installations, processed_events cascade'
redis-cli -n 2 flushdb >/dev/null 2>&1 || docker exec pullpanda-redis-1 redis-cli -n 2 flushdb >/dev/null
