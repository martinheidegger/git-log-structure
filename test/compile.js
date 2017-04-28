'use strict'
var test = require('tap').test
var compile = require('../compile.js')
var path = require('path')
var fs = require('fs')
var git = require('nodegit')

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
  if (data.errors) {
    data.errors.forEach(function (error) {
      usedCommits[error.commit] = true
    })
  }
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

function compareCompiled (t, target, options) {
  var expected = JSON.parse(fs.readFileSync(path.join(__dirname, target, 'expected.json')))
  return compile('test/' + target + '/test.json', options)
    .then(function (data) {
      if (data.errors) {
        data.errors.forEach(function (error) {
          delete error.message // for some reasons deepEqual can not match the error messages properly
          delete error.stack // the stack is going to be different on every computer
        })
      }
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
test('A file where each properties were changed in turn twice (complex_modification)', function (t) {
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
test('A simple file with a passed-in repo', function (t) {
  return git.Repository.open('.')
    .then(function (repo) {
      return compareCompiled(t, 'data/simple', {
        repo: repo
      })
    })
})
test('A file that was added broken and later fixed', function (t) {
  return compareCompiled(t, 'data/broken_file_fixed')
})
test('A simple file that was broken and later fixed', function (t) {
  return compareCompiled(t, 'data/simple_broken_fixed')
})
test('A simple file that was renamed and modified at the same commit', function (t) {
  return compareCompiled(t, 'data/simple_renamed_modified')
})
test('A unparsable file', function (t) {
  return compareCompiled(t, 'data/broken_file')
})
test('A file that changed type', function (t) {
  return compareCompiled(t, 'data/type_changer')
})
test('A file with mixed authors', function (t) {
  return compareCompiled(t, 'data/multi_authors')
})
// TODO: test('A custom parser with recursive objects')
// TODO: test('A simple file which\'s property was renamed') <-- NP Hard
test('A custom parser', function (t) {
  return compareCompiled(t, 'data/custom_parser', {
    parser: function (filePath, blob) {
      return Promise.resolve({
        a: blob.toString()
      })
    }
  })
})
test('A non-complient custom parser', function (t) {
  return compile('test/data/custom_parser/test.json', {
    parser: function (filePath, blob) {
      return {}
    }
  }).then(function (data) {
    t.ok(Array.isArray(data.errors))
    t.equals(data.errors.length, 1)
    var error = data.errors[0]
    t.notEquals(error, undefined)
    t.equals(error.code, 'EPARSE')
  })
})
test('A non-commited file', function (t) {
  var pth = path.join(__dirname, 'data', 'not_commited', 'test.json')
  try {
    fs.unlinkSync(pth)
  } catch (e) {
    // no one cares
  }
  try {
    fs.writeFileSync(pth, JSON.stringify({
      a: 1
    }, null, 2))
  } catch (e) {
    t.fail(e)
    return
  }
  return compile('data/not_commited')
    .then(function (data) {
      t.fail(new Error('Returned successfully, even though it is supposed to have thrown an error.'))
    })
    .catch(function (err) {
      // TODO: Consider throwing a different error or returning successfully
      // alternatively can also allow for flag to switch between each option
      t.equal(err.code, 'ENOENT')
      t.end()
    })
})
test('A custom parser returning a Promise', function (t) {
  return compareCompiled(t, 'data/custom_parser', {
    parser: function (filePath, blob) {
      return Promise.resolve({
        a: blob.toString()
      })
    }
  })
})
test('A file that never existed', function (t) {
  return compile('test/data/simple/test.json', {
    limit: 1
  })
    .then(function (data) {
      // The first commit from top doesn't contain 1
      t.fail(new Error('Returned successfully, even though it is supposed to never have existed.'))
      t.end()
    })
    .catch(function (err) {
      t.equal(err.code, 'ENOENT')
      t.end()
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
