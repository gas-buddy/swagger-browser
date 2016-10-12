import fs from 'fs';
import winston from 'winston';
import express from 'express';
import bodyParser from 'body-parser';
import findPackages from './packageFinder';
import detectNpmToken from './npmToken';
import registerApi from './handlers';

global.Promise = require('bluebird');

try {
  const env = fs.readFileSync('.env', 'utf8');
  if (env) {
    const overlay = {};
    env.split('\n').forEach((line) => {
      const m = line.match(/\s*([^=]+)=(.*)\r?/);
      if (m) {
        overlay[m[1]] = m[2];
      }
    });
    Object.assign(process.env, overlay);
  }
} catch (error) {
  // No .env
}

if (!process.env.NPM_TOKEN) {
  detectNpmToken();
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

async function refreshPackages() {
  if (process.env.NPM_TOKEN && process.env.GITHUB_TOKEN && process.env.GITHUB_ORG) {
    winston.info('Refreshing package information');
    const packages = await findPackages(process.env.GITHUB_ORG);
    if (packages) {
      winston.info(`${Object.getOwnPropertyNames(packages || []).length} packages read`);
      app.set('swagger-packages', packages);
    }
    // 10 minute refresh
    setTimeout(refreshPackages, 10 * 60000);
  }
}

refreshPackages();

app.get('/', (req, res, next) => {
  if (!process.env.NPM_TOKEN || !process.env.GITHUB_TOKEN || !process.env.GITHUB_ORG) {
    res.send(`
    <html>
    <head>
      <link rel="stylesheet" href="http://yui.yahooapis.com/pure/0.6.0/base-min.css">
      <link rel="stylesheet" href="http://yui.yahooapis.com/pure/0.6.0/pure-min.css">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head><body>
      <div style="margin-left: 50px;">
        <h1>Configuration Needed</h1>
        <p>You must set the organization, github token and npm token for this swagger-browser.
        These can be read from the environment on browser startup using the specified variables.</p>
        <form class="pure-form pure-form-aligned" action="/" method="post">
        <fieldset>
        <div class="pure-control-group" ${process.env.GITHUB_ORG ? 'style="display:none;"' : ''}>
          <label for="org">GITHUB_ORG</label><input type="text" name="org"/>
        </div>
        <div class="pure-control-group" ${process.env.GITHUB_TOKEN ? 'style="display:none;"' : ''}>
          <label for="org">GITHUB_TOKEN</label><input type="password" name="github"/>
        </div>
        <div class="pure-control-group" ${process.env.NPM_TOKEN ? 'style="display:none;"' : ''}>
          <label for="org">NPM_TOKEN</label><input type="password" name="npm"/>
        </div>
        <div class="pure-controls"><button type="submit" class="pure-button pure-button-primary">Submit</div>
        </fieldset>
        </form>
      </div>
    </body>
    </html>
        `);
  } else {
    next('route');
  }
});

app.post('/', async (req, res) => {
  process.env.GITHUB_ORG = process.env.GITHUB_ORG || req.body.org;
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || req.body.github;
  process.env.NPM_TOKEN = process.env.NPM_TOKEN || req.body.npm;
  await refreshPackages();
  res.redirect('/');
});

app.use(express.static('swagger-ui/dist'));
const port = process.env.PORT || 8080;
registerApi(app);
app.listen(port, () => {
  winston.info('swagger-browser listening', { port });
});
