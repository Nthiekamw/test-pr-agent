app.get("/user/:id", (req, res) => {
  db.query("SELECT * FROM users WHERE id = " + req.params.id);
});
app.get("/average", (req, res) => {
  const total = Number(req.query.total);
  const count = Number(req.query.count);
  res.send(String(total / count));
});
