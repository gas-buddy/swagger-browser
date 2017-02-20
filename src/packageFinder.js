import GitHubApi from 'github';
import request from 'superagent';
import winston from 'winston';
import targz from 'tar.gz';
import lowdb from 'lowdb';
import { spawn } from 'child_process';

const github = new GitHubApi({
  headers: {
    'user-agent': 'Swagger-Browser', // GitHub is happy with a unique user agent
  },
  timeout: 5000,
});
let authed = false;

function latestVersionOfPackage(pkg) {
  return new Promise((accept, reject) => {

    let child = spawn('npm', ['view', `${pkg.name}`, 'versions']);

    let versionData = null;
    child.stdout.on('data', (data) => {
      versionData = data;
    })

    child.on('exit', (code) => {
      if (code == 0 && versionData) {
        let availableVersions = JSON.parse(versionData.toString().replace(/'/g, '"'));
        let latestVersion = availableVersions[availableVersions.length - 1];
        winston.info(`Found ${latestVersion} as latest version of ${pkg.name}`);
        accept(availableVersions[availableVersions.length - 1]);
      } else {
        winston.warn(`Unable to fetch version data for ${pkg.name}`);
        reject({ code });
      }
    });
  });
}

async function fetchPackage(pkg) {
  let version = null;
  try {
    version = await latestVersionOfPackage(pkg);
    if (version !== pkg.version) {
      winston.warn(`${pkg.name} API is out of date. Master branch version: ${pkg.version} | Last published version: ${version})`);
    }
  } catch (exception) {
    return Promise.reject(`Could not find published API for ${pkg.name}. Please publish to NPM to view documentation.`)
  }

  winston.info(`Fetching ${pkg.name}@${version}`);

  return new Promise((accept, reject) => {
    try {
      const [scope, name] = pkg.name.split('/');
      const url = `https://registry.npmjs.org/${pkg.name}/-/${name || scope}-${version}.tgz`;
      const tgparse = targz().createParseStream();
      const targetFile = `package/${pkg.main}`;
      let found = false;
      tgparse.on('entry', (e) => {
        const f = e.props.path;
        if (f === targetFile) {
          const bufs = [];
          found = true;
          e.on('data', d => bufs.push(d)).on('end', () => {
            let json = JSON.parse(Buffer.concat(bufs).toString('utf8'));
            accept(json);
          });
        }
      });
      tgparse.on('end', () => {
        if (!found) {
          accept();
        }
      });
      const req = request
        .get(url)
        .set('Authorization', `Bearer ${process.env.NPM_TOKEN}`)
        .on('response', (res) => {
          if (res.status !== 200) {
            winston.warn(`Unable to fetch npm package for ${pkg.name}@${version}`);
            accept();
            req.abort();
          }
        });
      req.pipe(tgparse);
    } catch (exception) {
      reject(exception);
    }
  });
}

async function getApiSpec(org, repo) {
  try {
    const apiSpec = await github.repos.getContent({
      owner: org,
      repo: repo.name,
      path: 'api/package.json',
    });
    if (apiSpec && apiSpec.download_url) {
      const pkg = await request.get(apiSpec.download_url);
      const parsed = JSON.parse(pkg.text);
      const swagger = await fetchPackage(parsed);
      if (swagger) {
        return {
          name: repo.name,
          pushed_at: repo.pushed_at,
          swagger,
        };
      }
    } else {
      winston.info(`${repo.name} does not have api/package.json`);
    }
    return null;
  } catch (error) {
    if (error.code !== 404) {
      winston.error(`Failed to fetch ${repo.name}`, error);
      return null;
    }
    return {
      name: repo.name,
      pushed_at: repo.pushed_at,
    };
  }
}

export default async function getSwaggerDocuments(org) {
  if (!authed) {
    authed = true;
    github.authenticate({
      type: 'token',
      token: process.env.GITHUB_TOKEN,
    });
  }

  const db = lowdb('db.json');

  const repos = await github.repos.getForOrg({ org, per_page: 100 });
  // TODO pagination

  const docs = {};
  const needUpdate = repos.filter((r) => {
    if (!db.has(r.name).value()) {
      return true;
    }
    const value = db.get(r.name).value();
    if (value.pushed_at === r.pushed_at) {
      if (value.swagger) {
        docs[r.name] = value;
      }
      winston.info(`Will not fetch ${r.name}`);
      return false;
    }
    winston.info(`Will fetch ${r.name}`);
    return true;
  });
  try {
    const apis = await Promise.map(needUpdate, a => getApiSpec(org, a), { concurrency: 5 });
    for (const api of apis) {
      if (api) {
        db.set(api.name, api).value();
      }
      if (api && api.swagger) {
        docs[api.name] = api;
      }
    }
  } catch (fetchError) {
    winston.error('Failed to fetch APIs', fetchError);
    throw fetchError;
  }
  await db.write();
  return docs;
}
