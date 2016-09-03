'use strict'
var test = require('tap').test
var compile = require('../compile')
var path = require('path')
var fs = require('fs')

function assertCommitsExist (t, commits, data, name, usedCommits) {
  if (!usedCommits) {
    usedCommits = {}
  }
  var formerCommit = -1
  data.history.forEach(function (historyEntry, index) {
    if (historyEntry.commit < formerCommit) {
      t.fail(name + '\'s history entry #' + index + ' is in wrong order.')
    }
    formerCommit = historyEntry.commit
    if (historyEntry.commit > commits.length) {
      t.fail('The commit #' + historyEntry.commit + ' of ' + name + '\'s history entry #' + index + ' does not exist.')
    }
    usedCommits[formerCommit] = true
  })
  if (data.tree) {
    Object.keys(data.tree).forEach(function (treeKey) {
      assertCommitsExist(t, commits, data.tree[treeKey], name + '.' + treeKey, usedCommits)
    })
  }
  return usedCommits
}

function assertCommitsInHistoricOrder (t, commits) {
  var formerCommitTime = Number.MAX_VALUE
  commits.forEach(function (commit, commitIndex) {
    if (commit.time > formerCommitTime) {
      t.fail('The commit #' + commitIndex + ' is out of order.')
    }
    formerCommitTime = commit.time
  })
}

function assertCommitsUsed (t, commits, usedCommits) {
  commits.forEach(function (commit, commitIndex) {
    if (!usedCommits[commitIndex]) {
      t.fail('The commit #' + commitIndex + ' is unused.')
    }
  })
}

function compareCompiled (t, target, parser) {
  var expected = JSON.parse(fs.readFileSync(path.join(__dirname, target, 'expected.json')))
  return compile('test/' + target + '/test.json', null, parser)
    .then(function (data) {
      t.deepEqual(data, expected)
      const commits = data.commits
      assertCommitsInHistoricOrder(t, commits)
      const usedCommits = assertCommitsExist(t, commits, data, '$')
      assertCommitsUsed(t, commits, usedCommits)
      t.end()
    })
    .catch(function (err) {
      console.log(err)
      t.fail(err)
      t.end()
    })
}

test('A simple file in a repo should have the same age for all properties', function (t) {
  return compareCompiled(t, 'data/simple')
})
test('A simple file in a repo with a tree have the same age for all properties', function (t) {
  return compareCompiled(t, 'data/simple_with_tree')
})
test('A simple file in a repo with an added property', function (t) {
  return compareCompiled(t, 'data/simple_added')
})
test('A simple file in a repo with an removed property', function (t) {
  return compareCompiled(t, 'data/simple_removed')
})
test('A simple file in a repo with an changed property', function (t) {
  return compareCompiled(t, 'data/simple_modified')
})
test('A simple file in a repo with a twice changed property', function (t) {
  return compareCompiled(t, 'data/simple_modified_twice')
})
test('A simple file in a repo with an expanded property', function (t) {
  return compareCompiled(t, 'data/simple_expanded')
})
test('A simple file in a repo with a reduced property', function (t) {
  return compareCompiled(t, 'data/simple_reduced')
})
test('A renamed file', function (t) {
  return compareCompiled(t, 'data/renamed')
})
test('A complexly renamed file', function (t) {
  return compareCompiled(t, 'data/multiple-renamings')
})
test('A file where each properties were changed in turn twice', function (t) {
  return compareCompiled(t, 'data/complex_modification')
})
test('A simple yaml file', function (t) {
  var target = 'data/simple_yaml'
  var expected = JSON.parse(fs.readFileSync(path.join(__dirname, target, 'expected.json')))
  return compile('test/' + target + '/test.yml')
    .then(function (data) {
      t.deepEqual(data, expected)
      t.end()
    })
    .catch(function (err) {
      console.log(err)
      t.fail(err)
      t.end()
    })
})
test('A custom parser', function (t) {
  return compareCompiled(t, 'data/custom_parser', function (filePath, blob) {
    return {
      a: blob.toString()
    }
  })
})
test('A custom parser returning a Promise', function (t) {
  return compareCompiled(t, 'data/custom_parser', function (filePath, blob) {
    return Promise.resolve({
      a: blob.toString()
    })
  })
})
test('A file that never existed', function (t) {
  return compile('data/never_existed/test.json')
    .then(function (data) {
      t.fail(new Error('Returned successfully, even though it is supposed to never have existed.'))
      t.end()
    })
    .catch(function (err) {
      t.equal(err.code, 'ENOENT')
      t.end()
    })
})
