'use strict'
const git = require('nodegit')
const last = require('lodash.last')

function toStoryObject (value, commit) {
  if (typeof value === 'object' && value !== null) {
    var keys = Object.keys(value)
    var keyLength = keys.length
    if (keyLength > 0) {
      var tree = {}
      for (var i = 0; i < keyLength; i++) {
        var key = keys[i]
        // TODO: recursive check
        tree[key] = toStoryObject(value[key], commit)
      }
      return {
        tree: tree,
        history: [{type: 'added', commit: commit}]
      }
    }
  }
  return {
    value: value,
    history: [{type: 'added', commit: commit}]
  }
}

function addStory (result, newStory, previousCommit, parent, key) {
  var before
  if (!newStory) {
    // Nothing to do here, the result was added before
  } else if (result.tree) {
    if (!newStory.tree) {
      before = last(result.history)
      before.type = 'expanded'
      before.from = newStory.value
      result.history.push(newStory.history[0])
    } else {
      var foundKeys = Object
        .keys(result.tree)
        .reduce(function (foundKeys, resultKey) {
          foundKeys[resultKey] = true
          addStory(result.tree[resultKey], newStory.tree[resultKey], previousCommit, result, resultKey)
          return foundKeys
        }, {})
      Object
        .keys(newStory.tree)
        .filter(function (newStoryKey) {
          return !foundKeys[newStoryKey]
        })
        .forEach(function (newStoryKey) {
          result.tree[newStoryKey] = {
            value: undefined,
            history: [
              {type: 'deleted', commit: previousCommit, from: newStory.tree[newStoryKey]},
              newStory.history[0]
            ]
          }
        })
      before = last(result.history)
      before.commit++
    }
  } else if (newStory.tree) {
    before = last(result.history)
    before.type = 'reduced'
    before.from = newStory.tree
    result.history.push(newStory.history[0])
  } else if (result.value !== newStory.value) {
    var beforeBefore = result.history[result.history.length - 2]
    if (!beforeBefore || beforeBefore.type !== 'modified' || beforeBefore.from !== newStory.value) {
      before = last(result.history)
      before.type = 'modified'
      before.from = newStory.value
      result.history.push(newStory.history[0])
    } else {
      before = last(result.history)
      before.commit++
    }
  } else {
    before = last(result.history)
    before.commit++
  }
}

function processCommit (repo, historyEntry, commit, result, parser) {
  var newPath = historyEntry.newName || result.path
  var oldPath = historyEntry.oldName || result.path
  return commit.getDiff()
    .then(function (diffs) {
      for (var diffNr = 0; diffNr < diffs.length; diffNr++) {
        var diff = diffs[diffNr]
        var deltas = diff.numDeltas()
        for (var i = 0; i < deltas; i++) {
          var delta = diff.getDelta(i)
          if (newPath === delta.newFile().path()) {
            var id = delta.newFile().id()
            return repo.getBlob(id)
              .then(function (blob) {
                return parser(newPath, blob.content())
              })
              .catch(function (err) {
                var parseErr = new Error('EPARSE: Error while parsing: ' + newPath + '\n  ' + err.message)
                parseErr.stack = parseErr.stack + '\n' + err.stack
                parseErr.code = 'EPARSE'
                return Promise.reject(parseErr)
              })
              .then(function (data) {
                var story = toStoryObject(data, result.commits ? result.commits.length : 0)
                if (!result.commits) {
                  story.path = result.path
                  story.commits = []
                  result = story
                } else {
                  addStory(result, story, result.commits.length - 1)
                }
                result.commits.push({
                  time: commit.date().getTime(),
                  sha: commit.sha(),
                  message: commit.message(),
                  path: result.path
                })
                if (oldPath && result.path !== oldPath) {
                  result.path = oldPath
                  result.history.splice(result.commits.length - 2, 0, {
                    type: "moved",
                    oldPath: oldPath,
                    commit: result.commits.length - 1
                  })
                  return walkPath(repo, result, commit.sha(), true, parser)
                }
                return result
              })
          }
        }
      }
      return Promise.reject(new Error('No diff for ' + result.path + ' found in commit ' + commit.sha()))
    })
}

function processHistoryEntries (repo, historyEntries, result, parser) {
  if (historyEntries.length === 0) {
    return result.commits ? result : null
  } else {
    var errorMemo = null
    var historyEntry = historyEntries.shift()
    return repo.getCommit(historyEntry.commit.sha())
      .then(function (commit) {
        return processCommit(repo, historyEntry, commit, result, parser)
      })
      .catch(function (error) {
        errorMemo = error
        return result
      })
      .then(function (newResult) {
        // Recursive! Weeee
        return processHistoryEntries(repo, historyEntries, newResult, parser) || newResult
      })
      .then(function (newResult) {
        if (!newResult.history && errorMemo) {
          return Promise.reject(errorMemo)
        }
        return newResult
      })
  }
}
function walkPath (repo, result, commit, skip, parser) {
  var walker = repo.createRevWalk()
  walker.sorting(git.Revwalk.SORT.TIME)
  if (commit) {
    walker.push(commit)
  } else {
    walker.pushHead()
  }
  return walker.fileHistoryWalk(result.path, 10000).then(function (historyEntries) {
    if (historyEntries.length === 0) {
      var err = new Error('ENOENT: file does not exist in repository \'' + result.path + '\'')
      err.code = 'ENOENT'
      return Promise.reject(err)
    }
    if (skip) {
      historyEntries.shift()
    }
    return processHistoryEntries(repo, historyEntries, result, parser)
  })
}

function compileWithRepo (filePath, repo, parser) {
  return walkPath(repo, { path: filePath }, null, false, parser || require('./defaultParser.js'))
    .then(function (story) {
      // The story's path changes during the walkPath operation
      // After everything is done lets reset it to original path
      story.path = filePath
      return story
    })
}

module.exports = function compile (filePath, repo, parser) {
  if (!repo) {
    return git.Repository.open('.')
      .then(function (repo) {
        return compileWithRepo(filePath, repo, parser)
      })
  }
  return compileWithRepo(filePath, repo, parser)
}
