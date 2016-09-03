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

function processCommit (repo, commit, result, parser) {
  return commit.getDiff()
    .then(function (diffs) {
      for (var diffNr = 0; diffNr < diffs.length; diffNr++) {
        var diff = diffs[diffNr]
        var deltas = diff.numDeltas()
        for (var i = 0; i < deltas; i++) {
          var delta = diff.getDelta(i)
          var newPath = delta.newFile().path()
          if (result.path === newPath) {
            for (var j = 0; j < deltas; j++) {
              if (i !== j) {
                var otherDelta = diff.getDelta(j)
                if (otherDelta.oldFile().id().cmp(delta.newFile().id()) === 0) {
                  // It moved! See: https://github.com/nodegit/nodegit/issues/1116
                  result.path = otherDelta.newFile().path()
                  return walkPath(repo, result, commit.sha(), true, parser)
                }
              }
            }
            return repo.getBlob(delta.newFile().id())
              .then(function (blob) {
                var targetPath = delta.newFile().path()
                var data = parser(targetPath, blob.content())
                result.path = targetPath
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
        return processCommit(repo, commit, result, parser)
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
        if (newResult.length === 0 && errorMemo) {
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
