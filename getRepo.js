'use strict'
const git = require('nodegit')

module.exports = function compile (repo, path) {
  if (repo) {
    return Promise.resolve(repo)
  }
  return git.Repository.open(path || '.')
    .then(function (repo) {
      return repo
    })
}
