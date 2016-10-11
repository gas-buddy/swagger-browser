import winston from 'winston';
import findPackages from './packageFinder';
import detectNpmToken from './npmToken';

global.Promise = require('bluebird');

if (!process.env.NPM_TOKEN) {
  detectNpmToken();
}

const org = 'gas-buddy';

findPackages(org)
  .then((packages) => {
    winston.info(`${Object.getOwnPropertyNames(packages || []).length} packages read`);
  })
  .catch((error) => {
    winston.error('Startup failed', error);
  });
