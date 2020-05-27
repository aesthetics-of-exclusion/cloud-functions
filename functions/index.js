const admin = require('firebase-admin')

admin.initializeApp()

const db = admin.firestore()

const triggers = require('./triggers')(db)
const httpsFunctions = require('./https-functions')(db)

// Hoe datadump?
// Hoe count van hoeveel annotaties er nog moeten van bepaald type?

exports.watchAnnotations = triggers.watchAnnotations
exports.annotations = httpsFunctions.annotations
