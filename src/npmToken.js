import fs from 'fs';
import os from 'os';
import path from 'path';
import winston from 'winston';

export default function detectNpmToken() {
  try {
    const npmrc = fs.readFileSync(path.join(os.homedir(), '.npmrc'), 'utf8');
    const match = npmrc.match(/\/\/registry\.npmjs\.(?:com|org)\/:_authToken=(.*)/);
    if (!match || !match[1]) {
      winston.error('You must run \'npm login\' to get access to private packages.');
    }
    process.env.NPM_TOKEN = match[1];
  } catch (error) {
    winston.error(
      // eslint-disable-next-line max-len
      'Could not find NPM_TOKEN value in .npmrc. Either fix the error or set it manually in the environment',
      error);
  }
}
