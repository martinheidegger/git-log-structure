'use strict'
const git = require('nodegit')
const last = require('lodash.last')

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

function addStory (result, newStory, previousTime, parent, key) {
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
          addStory(result.tree[resultKey], newStory.tree[resultKey], previousTime, result, resultKey)
          return foundKeys
        }, {})
      Object
        .keys(newStory.tree)
        .filter(function (newStoryKey) {
          return !foundKeys[newStoryKey]
        })
        .forEach(function (newStoryKey) {
          result.tree[newStoryKey] = {
            value: null,
            history: [
              {type: 'deleted', time: previousTime},
              newStoryKey.history[0]
            ]
          }
        })
      before = last(result.history)
      before.time = newStory.history[0].time
    }
  } else if (newStory.tree) {
    before = last(result.history)
    before.type = 'reduced'
    before.from = newStory.tree
    result.history.push(newStory.history[0])
  } else if (result.value !== newStory.value) {
    before = last(result.history)
    before.type = 'modfied'
    before.from = newStory.value
    result.history.push(newStory.history[0])
  } else {
    before = last(result.history)
    before.time = newStory.history[0].time
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
              // console.log(newPath, result)
              if (result.path === newPath) {
                //console.log('found current path')
                result.path = delta.oldFile().path()
                //console.log('moved to ', result.path)
                //console.log('found id', delta.newFile().id())
                return repo.getBlob(delta.newFile().id())
                  .then(function (blob) {
                    var data = JSON.parse(blob.content())
                    var currentTime = commitDate.getTime()
                    var story = toStoryObject(data, currentTime)
                    if (result.time === -1) {
                      story.path = result.path
                      result = story
                    } else {
                      addStory(result, story, result.time)
                    }
                    result.time = currentTime
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
    return null
  } else {
    if (!result) {
      result = {
        path: path,
        time: -1
      }
    }
    return processHistoryEntry(repo, historyEntries.shift(), result)
      .then(function (result) {
        // Recursive! Weeee
        return processHistoryEntries(repo, historyEntries, result.path, result) || result
      })
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
          return walker.fileHistoryWalk(path, 10000).then(function (historyEntries) {
            var story = false
            return processHistoryEntries(repo, historyEntries, path)
          }).then(function (story) {
            // console.log('')
            // console.log(JSON.stringify(story, null, 2))
            delete story.path
            delete story.time
            return story
          }) 
        })
    })
}
