const functions = require('firebase-functions')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')

function createRandom () {
  return Math.round(Math.random() * Number.MAX_SAFE_INTEGER)
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

async function randomPoi (db, annotationType) {
  const random = createRandom()

  const lessThanRandomQuery = db.collection('pois')
    .where(`annotations.${annotationType}`, '==', 0)
    .where('random', '<=', random)
    .orderBy('random', 'desc')
    .limit(1)

  const lessThanRandomQuerySnapshot = await lessThanRandomQuery.get()

  let poiRef
  if (lessThanRandomQuerySnapshot.docs.length) {
    poiRef = lessThanRandomQuerySnapshot.docs[0]
  } else {
    const moreThanRandomQuery = db.collection('pois')
      .where(`annotations.${annotationType}`, '==', 0)
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
    dateCreated,
    dateUpdated: new Date()
  })

  return updatedAnnotationRef
}

module.exports = function (db) {
  const app = express()

  app.use(cors({ origin: true }))
  app.use(bodyParser.json())

  app.get('/next/:type', async (req, res) => {
    const type = req.params.type
    const poiRef = await randomPoi(db, type)

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
