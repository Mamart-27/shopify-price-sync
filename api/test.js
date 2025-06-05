const axios = require('axios');

module.exports = async (req, res) => {
  res.status(200).json({ axiosVersion: require('axios/package.json').version });
};
