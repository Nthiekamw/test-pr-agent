app.get("/user/:id", (req, res) => {
  db.query("SELECT * FROM users WHERE id = " + req.params.id);
});
