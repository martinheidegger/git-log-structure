'use strict'
const git = require('nodegit')
const last = require('lodash.last')
const path = require('path')
var jsYaml

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

function toStoryObject (value, commit) {
  if (typeof value === 'object' && typeof value !== null) {
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
              {type: 'deleted', commit: previousCommit, from: newStory.tree[newStoryKey] },
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

function processHistoryEntry (repo, historyEntry, result) {
  var commitSha = historyEntry.commit.sha()
  return repo.getCommit(commitSha)
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
              if (result.path === newPath) {
                for (var j = 0; j < deltas; j++) {
                  if (i !== j) {
                    var otherDelta = diff.getDelta(j)
                    if (otherDelta.oldFile().id().cmp(delta.newFile().id()) === 0) {
                      // It moved! See: https://github.com/nodegit/nodegit/issues/1116
                      result.path = otherDelta.newFile().path()
                      //result.path = delta.oldFile().path()
                      return walkPath(repo, result, commitSha, true)
                    }
                  }
                }
                //console.log('found current path')
                // console.log('moved to ', delta.newFile().path())
                // console.log('moved to ', delta.oldFile().path())
                //console.log('found id', delta.newFile().id())
                return repo.getBlob(delta.newFile().id())
                  .then(function (blob) {
                    var data
                    var targetPath = delta.newFile().path()
                    if (/\.ya?ml$/ig.test(path.extname(targetPath))) {
                      if (!jsYaml) {
                        jsYaml = require('js-yaml')
                      }
                      data = jsYaml.load(blob.content().toString())
                    } else {
                      data = JSON.parse(blob.content())
                    }
                    result.path = targetPath
                    var currentTime = commitDate.getTime()
                    var story = toStoryObject(data, result.commits ? result.commits.length : 0)
                    if (!result.commits) {
                      story.path = result.path
                      story.commits = []
                      result = story
                    } else {
                      addStory(result, story, result.commits.length - 1)
                    }
                    result.commits.push({
                      time: currentTime,
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
    })
}

function processHistoryEntries (repo, historyEntries, path, result) {
  if (historyEntries.length === 0) {
    return result.commits ? result : null
  } else {
    var errorMemo = null
    return processHistoryEntry(repo, historyEntries.shift(), result)
      .catch(function (error) {
        errorMemo = error
        return result
      })
      .then(function (result) {
        // Recursive! Weeee
        return processHistoryEntries(repo, historyEntries, result.path, result) || result
      })
      .then(function (result) {
        if (result.length === 0 && errorMemo) {
          return Promise.reject(errorMemo)
        }
        return result
      })
  }
}
function walkPath (repo, result, commit, skip) {
  // console.log('walking from ', commit, 'for', result.path)
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
    return processHistoryEntries(repo, historyEntries, result.path, result)
  })
}

module.exports = function compile (path, repo) {
  return getRepo(path, repo)
    .then(function (repo) {
      return walkPath(repo, {
        path: path
      }).then(function (story) {
        story.path = path
        return story
      })
    })
}
