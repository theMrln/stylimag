const { MongoDBContainer } = require('@testcontainers/mongodb')
const mongoose = require('mongoose')
const migrate = require('db-migrate')

async function setup() {
  let container
  let url
  
  if (process.env.TEST_DATABASE_URL) {
      url = process.env.TEST_DATABASE_URL
  } else {
    try {
        container = await new MongoDBContainer('mongo:6.0.19').start()
        url = container.getConnectionString() + '/stylo-tests'
    } catch (e) {
        console.warn('Could not start MongoDB container, falling back to local default: mongodb://127.0.0.1:27017/stylo-tests')
        url = 'mongodb://127.0.0.1:27017/stylo-tests'
    }
  }

  const migrateInstance = migrate.getInstance(true, {
    env: 'dev',
    config: {
      dev: {
        url: url,
        options: {
          directConnection: true,
        },
        overwrite: {
          driver: {
            require: '@ggrossetie/db-migrate-mongodb',
          },
        },
      },
    },
  })
  // Drop database instead of reset to avoid migration down errors
  const cleanupConnection = await mongoose.createConnection(url, { directConnection: true }).asPromise()
  await cleanupConnection.dropDatabase()
  await cleanupConnection.close()

  migrateInstance.silence(false)
  // await migrateInstance.reset() // reset is failing if indexes are missing
  await migrateInstance.up()
  mongoose.set('strictQuery', true)
  await mongoose.connect(url, {
    directConnection: true,
  })
  return container
}

async function teardown(container) {
  await mongoose.disconnect()
  if (container) {
      await container.stop()
  }
}

module.exports = {
  teardown,
  setup,
}
