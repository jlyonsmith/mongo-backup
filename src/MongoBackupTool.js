import parseArgs from 'minimist'
import { fullVersion } from './version'
import util from 'util'
import path from 'path'
import process from 'process'
import temp from 'temp'
import fs from 'fs'
import mongo from 'mongodb'
import mongoUri from 'mongodb-uri'
import { execSync } from 'child_process'
import moment from 'moment'
import { WebClient } from '@slack/client'

export class MongoBackupTool {
  constructor(log) {
    this.log = log
  }

  static findTool(name, dirs) {
    let foundPath = null

    for (let dir of dirs) {
      const toolPath = path.join(dir, name)

      if (fs.existsSync(toolPath)) {
        foundPath = toolPath
        break
      }
    }

    if (!foundPath) {
      throw new Error(`Unable to find tool '${name}'`)
    } else {
      return foundPath
    }
  }

  async doBackup() {
    const mkdirAsync = util.promisify(temp.mkdir)
    const dumpDirName = await mkdirAsync('mongo-backup-')

    this.log.info(`Backing up '${mongoUri.format(this.uri)}' from '${this.localHost}'`)

    try {
      if (this.uri.user && this.uri.password) {
        execSync(`${this.tools.mongodump} -h ${this.uri.fullHost} -u ${this.uri.user} -p ${this.uri.password} -d ${this.uri.database} -o ${dumpDirName}`)
      } else {
        execSync(`${this.tools.mongodump} -h ${this.uri.fullHost} -d ${this.uri.database} -o ${dumpDirName}`)
      }
    } catch (e) {
      this.log.error(`Unable to create dump of '${mongoUri.format(this.uri)}'. ${e.message}`)
      return false
    }

    const dateTime = moment().format('YYMMDD-hhmmss') + 'Z'

    this.backupFilename = `${this.localHost}-${this.uri.database}-${dateTime}.tar.gz`

    try {
      execSync(`${this.tools.tar} -czvf ${this.backupFilename} ${this.uri.database}/*`, { cwd: dumpDirName })
    } catch (e) {
      this.log.error(`Unable to tar file '${this.backupFilename}'. ${e.message}`)
      return false
    }

    try {
      execSync(`${this.tools.aws} s3 cp ${this.backupFilename} s3://${this.args.bucket}/ --profile ${this.args.profile}`, { cwd: dumpDirName })
    } catch (e) {
      this.log.error(`Unable to upload '${this.backupFilename}' to s3://${this.args.bucket}/. ${e.message}`)
      return false
    }

    let backupFilenames = []

    try {
      backupFilenames = execSync(`${this.tools.aws} s3 ls s3://${this.args.bucket} --profile ${this.args.profile}`).toString().split('\n')
    } catch (e) {
      this.log.error(`Unable to get list of existing backups from s3://${this.args.bucket}. ${e.message}`)
      return false
    }

    backupFilenames = backupFilenames.filter(f => f.startsWith(this.localHost) && !f.endsWith('.save') && f.trim().length > 0)
    backupFilenames.sort() // In-place sort

    let numBackupsToDelete = Math.max(0, backupFilenames.length - this.args.max)

    if (numBackupsToDelete > 0) {
      for (let i = 0; i < numBackupsToDelete; i++) {
        try {
          execSync(`${this.tools.aws} s3 rm s3://${this.args.bucket}/${backupFilenames[i]} --profile ${this.args.profile}`)
        } catch (e) {
          this.log.warning(`Unable to delete s3://${this.args.bucket}/${backupFilenames[i]}`)
        }
      }
    }

    return true
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version' ],
      string: [ 'profile', 'bucket', 'max', 'mongo', 'slack', 'channel' ],
      alias: {
        'p': 'profile',
        'b': 'bucket',
        'n': 'max',
        't': 'slack',
        'c': 'channel',
        'm': 'mongo'
      },
      default: {
        'max': '10'
      }
    }
    this.args = parseArgs(argv, options)

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    if (this.args.help) {
      this.log.info(`
usage: mongo-backup [options]

description:
  Backup a MongoDB database to an Amazon S3 bucket, delete older archives,
  and notify a Slack channel of status.

options:
  --profile, -p     AWS profile name
  --bucket, -b      AWS bucket name
  --max, -n         Maximum number of backups to keep
  --mongo, -m       Full URI of MongoDB to backup
  --slack, -t       Slack API token
  --channel, -c     Slack channel name (without the # prefix)
  --help            Shows this help
  --version         Shows the tool version
`)
      return 0
    }

    if (!this.args.profile) {
      this.log.error('Must specify an AWS profile')
      return false
    }

    if (!this.args.bucket) {
      this.log.error('Must specify AWS bucket name')
      return false
    }

    this.args.max = parseInt(this.args.max)

    if (this.args.max <= 0) {
      this.log.error('Max backups must be greater than zero')
      return false
    }

    if (!this.args.mongo) {
      this.log.error('Must specify a database to backup')
      return false
    }

    this.log.info(`Max backups is ${this.args.max}`)

    this.uri = null

    try {
      this.uri = mongoUri.parse(this.args.mongo)
    } catch (e) {
      this.log.error(`Unable to parse MongoDB URI. ${e.message}`)
      return false
    }

    const findTool = this.constructor.findTool
    this.tools = {}

    try {
      this.tools = {
        mongodump: findTool('mongodump', ['/usr/bin', '/usr/local/bin']),
        aws: findTool('aws', ['/usr/bin', '/usr/local/bin']),
        scutil: findTool('scutil', ['/usr/sbin']),
        tar: findTool('tar', ['/usr/bin']),
      }
    } catch (e) {
      this.log.error(e.message)
      return false
    }

    this.uri.host = this.uri.hosts[0].host
    this.uri.port = this.uri.hosts[0].port
    this.uri.fullHost = this.uri.host + (this.uri.port ? ':' + this.uri.port : '')

    this.localHost = ''

    try {
      this.localHost = execSync(`${this.tools.scutil} --get LocalHostName`).toString().trim()
    } catch (e) {
      this.log.error('Unable to retrieve local host name')
      return -1
    }

    let succeeded = await this.doBackup()
    let message = ''
    let attachments = {}

    if (succeeded) {
      message = 'MongoDB backup complete'
      attachments = [
        {
            color: "good",
            title: "MongoDB Backup Succeeded",
            ts: moment.utc().unix(),
            text: `A backup of database mongodb://${this.uri.fullHost}/${this.uri.database} was made from ${this.localHost} to s3://${this.args.bucket}/${this.backupFilename}`,
        }
      ]
    } else {
      message = "MongoDB backup failed"
      attachments = [
          {
              color: 'danger',
              title: 'MongoDB Backup Failed',
              ts: moment.utc().unix(),
              text: `A backup of database mongodb://${this.uri.fullHost}/${this.uri.database} from ${this.localHost} failed.`,
          }
      ]
    }

    if (!this.args.slack || !this.args.channel) {
      this.log.warning('No Slack API and/or channel token given; no notifications will be sent')
    } else {
      const webClient = new WebClient(this.args.slack)

      // See http://slackapi.github.io/node-slack-sdk/reference/ChatFacet#ChatFacet+postMessage
      try {
        await webClient.chat.postMessage(this.args.channel, message, { attachments, as_user: true })
      } catch (e) {
        this.log.warning(`Unable to send Slack message to ${this.args.channel}. ${e.message}`)
      }
    }

    this.log.info(succeeded ? 'Backup successful' : 'Backup failed')

    return 0
  }
}
