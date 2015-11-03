/**
 * Created by vedi on 09/02/15.
 */
'use strict';

var
  _ = require('lodash'),
  Bb = require('bluebird'),
  HTTP_STATUSES   = require('http-statuses'),
  mongoose  = require('mongoose'),
  ObjectID = mongoose.mongo.BSONPure.ObjectID;


function MongooseDataSource(ModelClass) {
  this.ModelClass = ModelClass;
}

MongooseDataSource.prototype.find = function (options) {
  var _this = this;
  return Bb.fromCallback(function (callback) {
    var filter = options.filter;
    var fields = options.fields.join(' ');
    var q = options.q;
    var qFields = options.qFields;
    var sort = options.sort;
    var limit = options.limit;
    var skip = options.skip;
    var queryPipe = options.queryPipe;

    _this._normalizeFilter(filter, _this.ModelClass);

    var qExpr = q ? _this._buildQ(qFields, q) : undefined;
    if (!_.isUndefined(qExpr) && qExpr.length > 0) {
      filter.$or = qExpr;
    }
    var query = _this.ModelClass.find(filter, fields);

    if (sort) {
      query.sort(sort);
    }
    query.limit(limit);
    if (skip > 0) {
      query.skip(skip);
    }
    if (queryPipe) {
      queryPipe(query);
    }
    return query.lean().exec(callback);
  });
};

MongooseDataSource.prototype.findOne = function findOne(options) {
  var _this = this;
  return Bb.fromCallback(function (callback) {
    var filter = options.filter;
    var fields = options.fields.join(' ');
    var queryPipe = options.queryPipe;

    _this._normalizeFilter(filter, _this.ModelClass);

    var query = _this.ModelClass.findOne(filter, fields);
    if (queryPipe) {
      queryPipe(query);
    }
    return query.exec(callback);
  });
};

MongooseDataSource.prototype.create = function create(data) {
  var _this = this;
  return Bb.fromCallback(function (callback) {
    return callback(null, new _this.ModelClass(data));
  });
};

MongooseDataSource.prototype.save = function save(doc) {
  return Bb.fromCallback(function (callback) {
    return doc.save(function (err, doc, numberAffected) {
      callback(err, doc);
    });
  });
};

MongooseDataSource.prototype.remove = function remove(doc) {
  return Bb.fromCallback(function (callback) {
    return doc.remove(callback);
  });
};

MongooseDataSource.prototype.count = function count(options) {
  var _this = this;
  return Bb.fromCallback(function (callback) {
    var filter = options.filter;
    var q = options.q;
    var qFields = options.qFields;

    // TODO: consider q-search in counting
    _this._normalizeFilter(filter, _this.ModelClass);
    return _this.ModelClass.count(filter).exec(callback);
  });
};

MongooseDataSource.prototype.toObject = function toObject(model) {
  return model.toObject();
};

MongooseDataSource.prototype.getFieldValue = function getFieldValue(model, fieldName) {
  return model.get(fieldName);
};

MongooseDataSource.prototype.setFieldValue = function getFieldValue(model, fieldName, value) {
  setProp(model, fieldName, value);
};

MongooseDataSource.prototype.proceedArrayMethod = function proceedArrayMethod(source, methodName, fieldName, scope) {
  var dest = scope.model;
  // get sure we have an array
  if (dest[fieldName] === undefined) {
    dest[fieldName] = [];
  }

  if (methodName === '$addToSet') {
    dest[fieldName].addToSet(source);
  } else if (methodName === '$pop') {
    if (source === 1) {
      dest[fieldName].pop();
    } else if (source === -1) {
      dest[fieldName].shift();
    } else {
      throw new Error('Illegal param value for $pop method');
    }
  } else if (methodName === '$push') {
    dest[fieldName].push(source);
  } else if (methodName === '$pull') {
    dest[fieldName].pull(source);
  }
};

MongooseDataSource.prototype.getModelFieldNames = function getModelFieldNames() {
  var paths = _.pluck(this.ModelClass.schema.paths, 'path');
  return _.filter(paths, function (fieldName) {
    return (fieldName == '_id' || fieldName.substr(0, 2) !== '__');
  })
};

MongooseDataSource.prototype.parseError = function parseError(err) {
  var result = {};
  if (err.name == 'ValidationError') {
    result.status = HTTP_STATUSES.BAD_REQUEST;
    result.details = err.errors;
  }
  else if (err.name == 'CastError') {
    result.status = HTTP_STATUSES.BAD_REQUEST;
    result.details = {};
    result.details[err.path] = {
      message: err.message,
      name: err.name,
      path: err.path,
      type: err.type,
      value: err.value
    };
    result.message = 'CastError';
  }
  else if (err.name == 'MongoError' && (err.code == 11000 || err.code == 11001)) { // E11000(1) duplicate key error index
    result.status = HTTP_STATUSES.BAD_REQUEST;
    result.details = err.err;
  }
  else if (err.name == 'VersionError') {
    result.status = HTTP_STATUSES.CONFLICT;
    result.details = err.message;
  } else {
    return;
  }

  return result;
};

MongooseDataSource.prototype._buildQ = function _buildQ(qFields, q) {
  var qExpr = [];
  _.forEach(qFields, function (qField) {
    var obj = {};
    obj[qField] = {$regex: '.*' + q + '.*', $options: 'i'};
    qExpr.push(obj);
  });
  return qExpr;
};

MongooseDataSource.prototype._normalizeFilter = function _normalizeFilter(filter, root) {
  _.forEach(_.keys(filter), function (key) {
    var path = root.schema.paths[key];
    // if it's an operator
    if (key.substr(0, 1) === '$') {
      // increase the level without changing the root
      this._normalizeFilter(filter[key], root);
    } else if (path) {
      var typeName = path.options.type.name;
      // it's embedded document
      if (!_.isUndefined(path.schema)) {
        this._normalizeFilter(filter[key], root.schema.paths[key]);
      } else if (typeName === 'ObjectId') {
        if (typeof(filter[key]) === 'string') {
          filter[key] = ObjectID(filter[key]);
        }
      } else if (typeName === 'Date') {
        if (typeof(filter[key]) === 'string') {
          filter[key] = new Date(filter[key]);
        }
        else if (typeof(filter[key]) === 'object') {
          _.forOwn(filter[key], function (value, innerKey) {
            if (typeof(value) === 'string') {
              filter[key][innerKey] = new Date(value);
            }
          });
        }
      }
    }
  }, this);
};


MongooseDataSource.prototype.defaultIdField = '_id';
MongooseDataSource.prototype.defaultArrayMethods = ['$addToSet', '$pop', '$push', '$pull'];


var setProp = function setProp(obj, stringPath, value) {
  stringPath = stringPath.replace(/\[(\w+)]/g, '.$1');  // convert indexes to properties
  stringPath = stringPath.replace(/^\./, '');           // strip a leading dot
  var pathArray = stringPath.split('.');
  while (pathArray.length - 1) {
    var pathItem = pathArray.shift();
    if (pathItem in obj) {
      obj = obj[pathItem];
    } else {
      return;
    }
  }
  return obj[pathArray.length ? pathArray[0] : stringPath] = value;
};

module.exports = MongooseDataSource;