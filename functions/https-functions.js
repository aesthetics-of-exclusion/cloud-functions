const admin = require('firebase-admin')
const functions = require('firebase-functions')
const H = require('highland')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const {BigQuery} = require('@google-cloud/bigquery')

function createRandom () {
  return Math.round(Math.random() * Number.MAX_SAFE_INTEGER)
}

function timestampToDate (timestamp) {
  return new admin.firestore.Timestamp(timestamp._seconds, timestamp._nanoseconds).toDate()
}

async function getAnnotations (db, poiId) {
  const snapshot = await db.collection('pois').doc(poiId).collection('annotations').get()

  return {
    id: poiId,
    annotations: snapshot.docs.map((doc) => {
      const data = doc.data()
      return Object.assign({
        id: doc.id
      }, data, {
        dateUpdated: data.dateUpdated.toDate(),
        dateCreated: data.dateCreated.toDate()
      })
    })
  }
}

function poiQuery (db, annotationType, source) {
  let query = db.collection('pois')
    .where(`annotations.${annotationType}`, '==', 0)

  if (source) {
    query = query
      .where('source', '==', source)
  }

  return query
}

async function randomPoi (db, annotationType, source) {
  const random = createRandom()

  const lessThanRandomQuery = poiQuery(db, annotationType, source)
    .where('random', '<=', random)
    .orderBy('random', 'desc')
    .limit(1)

  const lessThanRandomQuerySnapshot = await lessThanRandomQuery.get()

  let poiRef
  if (lessThanRandomQuerySnapshot.docs.length) {
    poiRef = lessThanRandomQuerySnapshot.docs[0]
  } else {
    const moreThanRandomQuery = poiQuery(db, annotationType, source)
      .where('random', '>=', random)
      .orderBy('random')
      .limit(1)

    const moreThanRandomQuerySnapshot = await moreThanRandomQuery.get()
    if (moreThanRandomQuerySnapshot.docs.length) {
      poiRef = moreThanRandomQuerySnapshot.docs[0]
    }
  }

  return poiRef
}

async function saveAnnotation (db, poiId, annotationType, data, annotationId) {
  const poiRef = db.collection('pois').doc(poiId)

  let annotationRef
  if (annotationId) {
    annotationRef = poiRef.collection('annotations').doc(annotationId)
  } else {
    annotationRef = poiRef.collection('annotations').doc()
  }

  let dateCreated = new Date()

  if (annotationId) {
    const annotation = await annotationRef.get()
    const oldDateCreated = annotation.data().dateCreated
    if (oldDateCreated) {
      dateCreated = oldDateCreated
    }
  }

  const updatedAnnotationRef = await annotationRef.set({
    poiId,
    type: annotationType,
    data,
    random: createRandom(),
    dateCreated,
    dateUpdated: new Date()
  })

  return updatedAnnotationRef
}

module.exports = function (db) {
  const app = express()

  app.use(cors({ origin: true }))
  app.use(bodyParser.json())

  app.get('/all.ndjson', async (req, res) => {
    const bigQuery = new BigQuery({ projectId: 'streetswipe-aoe' })

    const query = `SELECT * FROM streetswipe.annotations_raw_latest`

    const stream = H()

    bigQuery.createQueryStream(query)
      .on('error', console.error)
      .on('data', (row) => stream.write(row))
      .on('end', () => stream.end())

    stream
      .map((row) => JSON.parse(row.data))
      .map((annotation) => Object.assign(annotation, {
        dateCreated: timestampToDate(annotation.dateCreated),
        dateUpdated: timestampToDate(annotation.dateUpdated)
      }))
      .group('poiId')
      .map((groups) => Object.entries(groups).map(([poiId, annotations]) => ({
        id: poiId,
        annotations
      })))
      .flatten()
      .map(JSON.stringify)
      .intersperse('\n')
      .pipe(res)
  })

  app.get('/aggregated', async (req, res) => {
    const getAggregatedAnnotationsRef = db.collection('aggregates').doc('annotations')
    const aggregatedAnnotations = await getAggregatedAnnotationsRef.get()
    res.send(aggregatedAnnotations.data())
  })

  app.get('/next/:type', async (req, res) => {
    const type = req.params.type
    const source = req.query.source

    // If we would like to add a city parameter to check-screenshots and
    // facade-cutter (and possibly to other apps/tools), we could add a query
    // parameter to this API, and only return POIs from a specific city.
    // Adding a parameter to the query in the randomPoi function can be done with
    // a single extra where clause, but it's important to also add a new Composite
    // index to the Firebase database:
    // https://console.firebase.google.com/project/streetswipe-aoe/database/firestore/indexes

    const poiRef = await randomPoi(db, type, source)

    if (poiRef) {
      const annotations = await getAnnotations(db, poiRef.id)
      res.send(annotations)
    } else {
      res.status(404).send({message: 'No POIs found'})
    }
  })

  app.get('/:poiId', async (req, res) => {
    const poiId = req.params.poiId
    const annotations = await getAnnotations(db, poiId)
    res.send(annotations)
  })

  app.post('/:poiId/:annotationType/:annotationId?', async (req, res) => {
    const poiId = req.params.poiId
    const annotationType = req.params.annotationType
    const annotationId = req.params.annotationId
    const data = req.body

    try {
      const annotationRef = await saveAnnotation(db, poiId, annotationType, data, annotationId)

      res.send({
        updated: annotationRef.id
      })
    } catch (err) {
      res.status(500).send({
        message: err.message
      })

      throw err
    }
  })

  return {
    annotations: functions.https.onRequest(app)
  }
}
