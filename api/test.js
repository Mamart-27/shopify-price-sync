const axios = require('axios');

// api/test.js
module.exports = (req, res) => {
  res.status(200).json({ message: "✅ Test route working!" });
};
