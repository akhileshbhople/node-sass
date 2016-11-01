/*!
 * node-sass: scripts/build.js
 */

var eol = require('os').EOL,
  pkg = require('../package.json'),
  fs = require('fs'),
  mkdir = require('mkdirp'),
  path = require('path'),
  spawn = require('cross-spawn'),
  sass = require('../lib/extensions');

/**
 * After build
 *
 * @param {Object} options
 * @api private
 */

function afterBuild(options) {
  var install = sass.getBinaryPath();
  var target = path.join(__dirname, '..', 'build',
    options.debug ? 'Debug' :
        process.config.target_defaults
            ?  process.config.target_defaults.default_configuration
            : 'Release',
    'binding.node');

  mkdir(path.dirname(install), function(err) {
    if (err && err.code !== 'EEXIST') {
      console.error(err.message);
      return;
    }

    fs.stat(target, function(err) {
      if (err) {
        console.error('Build succeeded but target not found');
        return;
      }

      fs.rename(target, install, function(err) {
        if (err) {
          console.error(err.message);
          return;
        }

        console.log('Installed in "' + install + '"');
      });
    });
  });
}

/**
 * manageProcess
 *
 * @param {ChildProcess} proc
 * @param {Function} cb
 * @api private
 */

function manageProcess(proc, cb) {
  var errorMsg = '';
  proc.stderr.on('data', function(data) {
    errorMsg += data.toString();
  });
  proc.on('close', function(code) {
    cb(code === 0 ? null : { message: errorMsg });
  });
}

/**
 * initSubmodules
 *
 * @param {Function} cb
 * @api private
 */

function initSubmodules(cb) {
  console.log('Detected a git install');
  console.log('Cloning libSass into src/libsass');

  var clone = spawn('git', ['clone', 'https://github.com/sass/libsass.git', './src/libsass']);
  manageProcess(clone, function(err) {
    if (err) {
      cb(err);
      return;
    }

    console.log('Checking out libsass to ' + pkg.libsass);

    var checkout = spawn('git', ['checkout', pkg.libsass], { cwd: './src/libsass' });
    manageProcess(checkout, function(err) {
      cb(err);
    });
  });
}

/**
 * installGitDependencies
 *
 * @param {Function} cb
 * @api private
 */

function installGitDependencies(options, cb) {
  var libsassPath = './src/libsass';

  if (process.env.LIBSASS_EXT || options.libsassExt) {
    cb();
  } else if (fs.access) { // node 0.12+, iojs 1.0.0+
    fs.access(libsassPath, fs.R_OK, function(err) {
      err && err.code === 'ENOENT' ? initSubmodules(cb) : cb();
    });
  } else { // node < 0.12
    fs.exists(libsassPath, function(exists) {
      exists ? cb() : initSubmodules(cb);
    });
  }
}

/**
 * Build
 *
 * @param {Object} options
 * @api private
 */

function build(options) {
  installGitDependencies(options, function(err) {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }

    var nodeGyp = resolveNodeGyp(options);
    
    var proc = spawn(nodeGyp.exeName, nodeGyp.args, {
      stdio: [0, 1, 2]
    });

    proc.on('exit', function(errorCode) {
      if (!errorCode) {
        afterBuild(options);

        return;
      }

      console.error(errorCode === 127 ? 'node-gyp not found!' : 'Build failed');
      process.exit(1);
    });
  });
}

function resolveNodeGyp(options) {
  var args = ['rebuild', '--verbose'].concat(
    ['libsass_ext', 'libsass_cflags', 'libsass_ldflags', 'libsass_library'].map(function (subject) {
      return ['--', subject, '=', process.env[subject.toUpperCase()] || ''].join('');
    })).concat(options.args);

  // For node-chakracore, check if node-gyp is in the path.
  // If yes, use it instead of using node-gyp directly from
  // node_modules because the one in node_modules is not
  // compatible with node-chakracore.
  // For node-v8, it is ok to rely on node-gyp present under
  // node_modules
  var nodePath = path.dirname(process.execPath);
  var useInstalledNodeGyp = process.jsEngine && process.jsEngine === 'chakracore' &&
    process.env.Path.split(';').find(function (path) {
      return path.startsWith(nodePath) &&
      path.endsWith('node-gyp-bin');
    }) !== 'undefined';

  var exeName = process.execPath;
  if (useInstalledNodeGyp) {
    exeName = 'node-gyp';
  } else {
    args.unshift(require.resolve(path.join('node-gyp', 'bin', 'node-gyp.js')));
  }

  console.log(['Building:', exeName].concat(args).join(' '));
  return {exeName : exeName, args: args};
}
/**
 * Parse arguments
 *
 * @param {Array} args
 * @api private
 */

function parseArgs(args) {
  var options = {
    arch: process.arch,
    platform: process.platform
  };

  options.args = args.filter(function(arg) {
    if (arg === '-f' || arg === '--force') {
      options.force = true;
      return false;
    } else if (arg.substring(0, 13) === '--target_arch') {
      options.arch = arg.substring(14);
    } else if (arg === '-d' || arg === '--debug') {
      options.debug = true;
    } else if (arg.substring(0, 13) === '--libsass_ext' && arg.substring(14) !== 'no') {
      options.libsassExt = true;
    }

    return true;
  });

  return options;
}

/**
 * Test for pre-built library
 *
 * @param {Object} options
 * @api private
 */

function testBinary(options) {
  if (options.force || process.env.SASS_FORCE_BUILD) {
    return build(options);
  }

  if (!sass.hasBinary(sass.getBinaryPath())) {
    return build(options);
  }

  console.log('"' + sass.getBinaryPath() + '" exists.', eol, 'testing binary.');

  try {
    require('../').renderSync({
      data: 's { a: ss }'
    });

    console.log('Binary is fine; exiting.');
  } catch (e) {
    console.log(['Problem with the binary:', e, 'Manual build incoming.'].join(eol));

    return build(options);
  }
}

/**
 * Apply arguments and run
 */

testBinary(parseArgs(process.argv.slice(2)));
