#!/bin/sh
# Starts N API instances on ports 3101.. with POOL connections each, the way a container platform would
# run N replicas behind a load balancer. Stop with: kill $(lsof -ti tcp:3101-3108 -sTCP:LISTEN)
N=${1:-1}; POOL=${2:-20}
cd "$(dirname "$0")/.." && . bench/env.sh
i=0; while [ $i -lt $N ]; do
  PORT=$((3101 + i)) DB_POOL_SIZE=$POOL bun apps/api/src/index.ts > /dev/null 2>&1 &
  i=$((i + 1))
done
wait
