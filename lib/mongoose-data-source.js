/**
 * Created by vedi on 09/02/15.
 */

'use strict';

const _ = require('lodash');
const Bb = require('bluebird');
const HTTP_STATUSES = require('http-statuses');
const { ObjectID } = require('bson').BSONPure;

class MongooseDataSource {
  constructor(ModelClass) {
    this.ModelClass = ModelClass;
    this.defaultIdField = '_id';
    this.defaultArrayMethods = ['$addToSet', '$pop', '$push', '$pull'];
  }

  find(options) {
    const { fields, filter, q, qFields, queryPipe, restrictFields = true, sort, distinctField } = options;
    const resolved = this._resolveAssociations(fields);
    const { populationQuery } = resolved;
    const limit = parseInt(options.limit, 10);
    const skip = parseInt(options.skip, 10);
    this._normalizeFilter(filter, this.ModelClass);
    const qExpr = q ? this._buildQ(qFields, q) : undefined;
    if (!_.isUndefined(qExpr) && qExpr.length > 0) {
      filter.$or = qExpr;
    }
    const query = this.ModelClass.find(filter, distinctField);
    if (distinctField) {
      query.distinct(distinctField);
    }
    if (restrictFields && !distinctField) {
      query.select(resolved.fields);
    }
    if (sort) {
      query.sort(sort);
    }
    if (!distinctField) {
      query.limit(limit);
    }
    if (!distinctField && skip > 0) {
      query.skip(skip);
    }
    if (!_.isEmpty(populationQuery)) {
      query.populate(populationQuery);
    }
    if (queryPipe) {
      queryPipe(query);
    }
    return query.lean().exec();
  }

  findOne(options) {
    const { fields, filter, queryPipe, restrictFields = true } = options;
    const resolved = this._resolveAssociations(fields);
    const { populationQuery } = resolved;
    this._normalizeFilter(filter, this.ModelClass);
    const query = this.ModelClass.findOne(filter);
    if (restrictFields) {
      query.select(resolved.fields);
    }
    if (!_.isEmpty(populationQuery)) {
      query.populate(populationQuery);
    }
    if (queryPipe) {
      queryPipe(query);
    }
    return query.exec();
  }

  create(data) {
    return Bb.resolve(this.ModelClass(data));
  }

  save(doc) {
    return doc.save();
  }

  remove(doc) {
    return doc.remove();
  }

  count(options) {
    const { filter, qFields, q } = options;
    this._normalizeFilter(filter, this.ModelClass);
    const qExpr = q ? this._buildQ(qFields, q) : undefined;
    if (!_.isUndefined(qExpr) && qExpr.length > 0) {
      filter.$or = qExpr;
    }
    return this.ModelClass.count(filter).exec();
  }

  toObject(model) {
    return model.toObject();
  }

  getFieldValue(model, fieldName) {
    return model.get(fieldName);
  }

  setFieldValue(model, fieldName, value) {
    model.set(fieldName, value);
  }

  proceedArrayMethod(source, methodName, fieldName, scope) {
    const { model: { [fieldName]: fieldValue = [] } } = scope;
    if (methodName === '$addToSet') {
      fieldValue.addToSet(source);
    } else if (methodName === '$pop') {
      if (source === 1) {
        fieldValue.pop();
      } else if (source === -1) {
        fieldValue.shift();
      } else {
        throw new Error('Illegal param value for $pop method');
      }
    } else if (methodName === '$push') {
      fieldValue.push(source);
    } else if (methodName === '$pull') {
      fieldValue.pull(source);
    }
  }

  assignField(fieldName, scope) {
    const { model, source } = scope;
    return this.setFieldValue(model, fieldName, source[fieldName]);
  }

  getModelFieldNames() {
    const paths = _.pluck(this.ModelClass.schema.paths, 'path');
    return _.filter(paths, fieldName => (fieldName === '_id' || fieldName.substr(0, 2) !== '__'));
  }

  parseError(err) {
    const result = {};
    if (err.name === 'ValidationError') {
      result.status = HTTP_STATUSES.BAD_REQUEST;
      result.error = 'ValidationError';
      result.message = err.message;
      result.details = _.reduce(err.errors, (result, {
        kind, path, value, message,
      }, key) => {
        result[key] = {
          kind, path, value, message,
        };
        return result;
      }, {});
    } else if (err.name === 'CastError') {
      result.status = HTTP_STATUSES.BAD_REQUEST;
      result.error = 'WrongDataType';
      result.message = err.message;
      result.details = {
        [err.path]: {
          message: err.message,
          name: err.name,
          path: err.path,
          type: err.type,
          value: err.value,
        },
      };
    } else if (err.name === 'MongoError' && (err.code === 11000 || err.code === 11001)) {
      // E11000(1) duplicate key error index
      result.status = HTTP_STATUSES.BAD_REQUEST;
      result.error = 'UniqueViolation';
      result.message = err.message;
      result.details = err.err;
    } else if (err.name === 'VersionError') {
      result.status = HTTP_STATUSES.CONFLICT;
      result.error = 'ConcurrentUpdating';
      result.message = err.message;
    } else {
      return;
    }
    return result;
  }

  _buildQ(qFields, q) {
    const qExpr = [];
    _.forEach(qFields, (qField) => {
      const obj = {};
      obj[qField] = { $regex: `.*${q}.*`, $options: 'i' };
      qExpr.push(obj);
    });
    return qExpr;
  }

  _normalizeFilter(filter, root) {
    _.keys(filter).forEach((key) => {
      const path = root.schema.paths[key];
      // if it's an operator
      if (key.substr(0, 1) === '$') {
        // increase the level without changing the root
        this._normalizeFilter(filter[key], root);
      } else if (path) {
        const typeName = path.options.type.name;
        // it's embedded document
        if (!_.isUndefined(path.schema)) {
          this._normalizeFilter(filter[key], root.schema.paths[key]);
        } else if (typeName === 'ObjectId') {
          if (typeof (filter[key]) === 'string') {
            filter[key] = ObjectID(filter[key]);
          }
        } else if (typeName === 'Date') {
          if (typeof (filter[key]) === 'string') {
            filter[key] = new Date(filter[key]);
          } else if (typeof (filter[key]) === 'object') {
            _.forOwn(filter[key], (value, innerKey) => {
              if (typeof (value) === 'string') {
                filter[key][innerKey] = new Date(value);
              }
            });
          }
        }
      }
    });
  }

  _resolveAssociations(fields) {
    const { ModelClass } = this;
    // recursive function for resolving of nested dependencies
    function recursiveResolve(ModelClass, obj) {
      const query = {
        path: obj.name || 'root',
        select: [],
        model: ModelClass.modelName,
      };
      const populate = []; // array for populate queries
      _.forEach(obj.fields, (field) => {
        if (_.isString(field)) {
          // simple `field`

          // add `field`s name to select list
          query.select.push(field);
        } else if (_.isObject(field) && !field.fields) {
          query.select.push(field.name);
        } else {
          // dependency `field`
          // find `field`s model name
          const branch = ModelClass.schema.tree[field.name];
          const ref = (branch[0] && branch[0].ref) || branch.ref;

          // build/extend populate condition
          populate.push(recursiveResolve(ModelClass.db.model(ref), field));

          // add field name to select list
          query.select.push(field.name);
        }
      });
      // add populate conditions
      if (populate.length > 0) {
        query.populate = populate;
      }
      // convert select array to space-separated string of field names
      query.select = query.select.join(' ');
      return query;
    }
    const result = recursiveResolve(ModelClass, { fields });
    return {
      fields: result.select || '',
      populationQuery: result.populate || [],
    };
  }
}

module.exports = MongooseDataSource;
