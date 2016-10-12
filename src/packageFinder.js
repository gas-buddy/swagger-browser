import GitHubApi from 'github';
import request from 'superagent';
import winston from 'winston';
import targz from 'tar.gz';
import lowdb from 'lowdb';

const github = new GitHubApi({
  headers: {
    'user-agent': 'Swagger-Browser', // GitHub is happy with a unique user agent
  },
  timeout: 5000,
});
let authed = false;

function fetchPackage(pkg) {
  winston.info(`Fetching ${pkg.name}@${pkg.version}`);
  return new Promise((accept, reject) => {
    try {
      const [scope, name] = pkg.name.split('/');
      const url = `https://registry.npmjs.org/${pkg.name}/-/${name || scope}-${pkg.version}.tgz`;
      const tgparse = targz().createParseStream();
      const targetFile = `package/${pkg.main}`;
      let found = false;
      tgparse.on('entry', (e) => {
        const f = e.props.path;
        if (f === targetFile) {
          const bufs = [];
          found = true;
          e.on('data', d => bufs.push(d)).on('end', () => {
            accept(JSON.parse(Buffer.concat(bufs).toString('utf8')));
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
            winston.warn(`Unable to fetch npm package for ${pkg.name}@${pkg.version}`);
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
