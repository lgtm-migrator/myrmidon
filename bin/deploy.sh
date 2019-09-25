#!/bin/bash
BIN_DIR=$(dirname "${BASH_SOURCE[0]}")

npx babel-node $BIN_DIR/documentation.js readme
npx babel-node $BIN_DIR/documentation.js reference
npm run push:release