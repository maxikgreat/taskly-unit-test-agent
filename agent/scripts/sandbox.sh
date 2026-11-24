#!/bin/sh
set -eu
cp -R /opt/taskly/frontend /opt/taskly/backend /work/
cp -R /input/frontend/src /work/frontend/
cp -R /input/backend/src /work/backend/
cp -R /input/backend/tests /work/backend/
node /opt/taskly/agent/node_modules/tsx/dist/cli.mjs /opt/taskly/agent/src/cli.ts --root /work --apply /proposal/proposal.json
cd /work/frontend
npm run typecheck
npm run test:coverage
cd /work/backend
npm run typecheck
npm run test:coverage
