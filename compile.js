'use strict'
const git = require('nodegit')

function getRepo (path, repo) {
  if (repo) {
    return Promise.resolve(repo)
  }
  return git.Repository.open('.')
}

function flatData (value, prefix, result) {
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    const l = keys.length
    for (var i = 0; i < l; ++i) {
      var key = keys[i]
      flatData(value[key], prefix !== '' ? (prefix + '.' + key) : key, result)
    }
  } else {
    result[prefix] = value
  }
  return result
}

function toStoryObject (value, date) {
  if (typeof value === 'object' && typeof value !== null) {
    var keys = Object.keys(value)
    var keyLength = keys.length
    if (keyLength > 0) {
      var tree = {}
      for (var i = 0; i < keyLength; i++) {
        var key = keys[i]
        // TODO: recursive check
        tree[key] = toStoryObject(value[key], date)
      }
      return {
        tree: tree,
        history: [{type: 'added', time: date}]
      }
    }
  }
  return {
    value: value,
    history: [{type: 'added', time: date}]
  }
}

module.exports = function compile (path, repo) {
  return getRepo(path, repo)
    .then(function (repo) {
      return repo.getHeadCommit()
        .then(function (headCommit) {
          var walker = repo.createRevWalk()
          walker.sorting(git.Revwalk.SORT.TIME)
          walker.push(headCommit)
          var currentPath = path
          return walker.fileHistoryWalk(path, 10000).then(function (commitSets) {
            var processCommit = function (resolve) {
              if (commitSets.length === 0) {
                return resolve(false);
              } else {
                var historyEntry = commitSets.shift()
                var commitSha = historyEntry.commit.sha()
                return resolve(repo.getCommit(commitSha)
                  .then(function (commit) {
                    var commitDate = commit.date()
                    return commit.getDiff()
                      .then(function (diffs) {
                        for (var diffNr = 0; diffNr < diffs.length; diffNr++) {
                          var diff = diffs[diffNr]
                          var deltas = diff.numDeltas()
                          for (var i = 0; i < deltas; i++) {
                            var delta = diff.getDelta(i)
                            var newPath = delta.newFile().path()
                            if (currentPath === newPath) {
                              // console.log('found current path')
                              currentPath = delta.oldFile().path()
                              // console.log('moved to ', currentPath)
                              // console.log('found id', delta.newFile().id())
                              return repo.getBlob(delta.newFile().id())
                                .then(function (blob) {
                                  var data = JSON.parse(blob.content());
                                  return toStoryObject(data, commitDate.getTime())
                                  return resolve(new Promise(processCommit))
                                })
                            }
                          }
                        }
                        return Promise.reject(new Error('No diff for ' + currentPath + ' found in commit ' + commitSha))
                      })
                  }))
              }
            }
            return new Promise(processCommit)
          })
        })
    })
}
