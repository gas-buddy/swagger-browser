export default function register(app) {
  app.get('/api/projects', (req, res) => {
    const matches = Object
      .getOwnPropertyNames(app.get('swagger-packages'))
      .filter(p => new RegExp(req.query.query || '.', 'i').test(p));
    res.json(matches);
  });

  app.get('/api/doc', (req, res) => {
    const { swagger } = app.get('swagger-packages')[req.query.service] || {};
    res.json(swagger);
  });
}
