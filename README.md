[![NPM](https://nodei.co/npm/restifizer-mongoose-ds.png?compact=true)](https://npmjs.org/package/restifizer-mongoose-ds)

> We are working hard to create documentation. If you have exact questions or ideas how we can improve documentation, create a ticket here: https://github.com/vedi/restifizer-mongoose-ds/issues

> Any feedback is appreciated.

Mongoose Data Source for Restifizer
==========

Restifizer - it's a way to significantly simplify creation of full-functional RESTful services. It's available at:
https://github.com/vedi/restifizer

This Data Source allows you to use mongoose model in your REST service. For example:

```
  MongooseDataSource = require('restifizer-mongoose-ds'),
  User = require('mongoose').model('User'),

...

module.exports = BaseController.extend({
  dataSource: new MongooseDataSource(User),
...

```

