const admin = require('firebase-admin')

admin.initializeApp()

const db = admin.firestore()

const triggers = require('./triggers')(db)
const httpsFunctions = require('./https-functions')(db)

exports.watchAnnotations = triggers.watchAnnotations
exports.annotations = httpsFunctions.annotations
