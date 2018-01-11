'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoBackupTool = undefined;

var _minimist = require('minimist');

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require('./version');

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _process = require('process');

var _process2 = _interopRequireDefault(_process);

var _temp = require('temp');

var _temp2 = _interopRequireDefault(_temp);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class MongoBackupTool {
  constructor(log) {
    this.log = log;
  }

  static findTool(name, paths) {
    let foundPath = null;

    for (let path of paths) {
      let fullPath = path.join(path, name);

      if (_fs2.default.existsSync(fullPath)) {
        foundPath = fullPath;
        break;
      }
    }

    if (!foundPath) {
      throw new Error(`Unable to find tool '${name}'`);
    }
  }

  async run(argv) {
    const options = {
      boolean: ['help', 'version'],
      string: ['profile', 'bucket', 'max', 'mongo', 'api', 'channel'],
      alias: {
        'p': 'profile',
        'b': 'bucket',
        'n': 'max',
        't': 'api',
        'c': 'channel'
      }
    };
    this.args = (0, _minimist2.default)(argv, options);

    const command = this.args._[0];

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    if (this.args.help || !command) {
      this.log.info(`
usage: mongo-backup [options]

description:
  Backup a MongoDB database to an Amazon S3 bucket, delete older archives,
  and notify a Slack channel of status.

options:
  [--profile | -p] PROFILE        AWS profile
  [--bucket | -b] BUCKET_NAME     AWS bucket
  [--max | -n] MAX_BACKUPS        Maximum number of backups to keep
  [--mongo | -m] MONGO_URI        Full URI of MongoDB to backup
  [--api | -t] SLACK_API_TOKEN    Slack API token
  [--channel | -c] SLACK_CHANNEL  Slack channel
  --help                          Shows this help
  --version                       Shows the tool version
`);
      return 0;
    }

    // main do
    //   profile = options[:profile]
    //   bucket_name = options[:bucket]
    //   max_backups = options[:max].to_i
    //   mongo_path = options[:mongo]
    //   slack_api_token = options[:api]
    //   slack_channel = options[:channel]
    //
    //   if profile.nil?
    //     exit_now! "Must specify AWS profile"
    //   end
    //
    //   if bucket_name.nil?
    //     exit_now! "Must specify AWS bucket name"
    //   end
    //
    //   if max_backups.nil? or max_backups == 0
    //     max_backups = 20
    //     puts "Max backups is #{max_backups}"
    //   end
    //
    //   if mongo_path.nil?
    //     exit_now! "Must specify a database to backup!"
    //   end
    //
    //   if slack_api_token.nil? or slack_channel.nil?
    //     puts "WARNING: No Slack API and/or channel token given, no notification will be sent"
    //   end
    //
    //   mongo_uri = Mongo::URI.new(mongo_path)
    //   database = mongo_uri.database
    //   user = mongo_uri.credentials[:user]
    //   password = mongo_uri.credentials[:password]
    //   mongo_server = mongo_uri.servers[0]
    //
    //   mongodump_tool = find_tool('mongodump', ['/usr/bin', '/usr/local/bin'])
    //   aws_tool = find_tool('aws', ['/usr/bin', '/usr/local/bin'])
    //   scutil_tool = find_tool('scutil', ['/usr/sbin'])
    //   tar_tool = find_tool('tar', ['/usr/bin'])
    //
    //   backup_status = :failed
    //
    //   Dir.mktmpdir do |dump_dir_name|
    //     begin
    //       local_host_name = `#{scutil_tool} --get LocalHostName`.strip
    //
    //       puts "Backing up mongodb://#{mongo_server}/#{database} from #{local_host_name}"
    //
    //       if !(user.nil? and password.nil?)
    //         `#{mongodump_tool} -h #{mongo_server} -u #{user} -p #{password} -d #{database} -o #{dump_dir_name}`
    //       else
    //         `#{mongodump_tool} -h #{mongo_server} -d #{database} -o #{dump_dir_name}`
    //       end
    //
    //       if $? != 0
    //         raise "Unable to create dump of mongodb://#{mongo_server}/#{database}"
    //       end
    //
    //       date_time = DateTime.now.strftime("%Y%m%d-%H%M%SZ")
    //
    //       backup_filename = "#{local_host_name}-#{database}-#{date_time}.tar.gz"
    //
    //       `cd #{dump_dir_name}; #{tar_tool} -czvf #{backup_filename} #{database}/*`
    //
    //       if $? != 0
    //         raise "Unable to create tar zip file '#{backup_filename}'"
    //       end
    //
    //       `cd #{dump_dir_name}; #{aws_tool} s3 cp #{backup_filename} s3://#{bucket_name}/ --profile #{profile}`
    //
    //       if $? != 0
    //         raise "Unable to upload '#{backup_filename}' to s3://#{bucket_name}/"
    //       end
    //
    //       # Reduce backups to desired maximum
    //       backup_filenames = `#{aws_tool} s3 ls s3://#{bucket_name} --profile #{profile}`.split('\n')
    //
    //       if $? != 0
    //         raise "Unable to get list of existing backups from s3://#{bucket_name}"
    //       end
    //
    //       # backup_filenames = %w(
    //       #   'host-database-20160624-002055Z.tar.gz',
    //       #   'host-database-20160620-002055Z.tar.gz',
    //       #   'host-database-20160621-002055Z.tar.gz',
    //       #   'host-database-20160708-002055Z.tar.gz',
    //       #   'host-database-20160601-002055Z.tar.gz.save',
    //       # )
    //       backup_filenames.sort!
    //       backup_filenames.delete_if { |f| f.match(/save/) }
    //       num_backups_to_delete = backup_filenames.count - max_backups
    //
    //       if num_backups_to_delete > 0
    //         (0...num_backups_to_delete).each { |i|
    //           `#{aws_tool} s3 rm s3://#{bucket_name}/#{backup_filenames[i]} --profile #{profile}`
    //
    //           if $? != 0
    //             puts "WARNING: Unable to delete s3://#{bucket_name}/#{backup_filenames[i]}"
    //           end
    //         }
    //       end
    //
    //       backup_status = :succeeded
    //     ensure
    //       Slack.configure do |config|
    //         config.token = slack_api_token
    //       end
    //
    //       unless slack_api_token.nil? or slack_channel.nil?
    //         if backup_status == :succeeded
    //           message = "MongoDB backup complete"
    //           attachments = [
    //             {
    //                 "color": "good",
    //                 "title": "MongoDB Backup Succeeded",
    //                 "text": "A backup of database mongodb://#{mongo_server}/#{database} was made from #{local_host_name} to s3://#{bucket_name}/#{backup_filename}",
    //                 "ts": Time.now.utc.to_i
    //             }
    //           ]
    //         else
    //           message = "MongoDB backup failed"
    //           attachments = [
    //               {
    //                   "color": "danger",
    //                   "title": "MongoDB Backup Failed",
    //                   "text": "A backup of database mongodb://#{mongo_server}/#{database} from #{local_host_name} failed.",
    //                   "ts": Time.now.utc.to_i
    //               }
    //           ]
    //         end
    //         begin
    //           slack = Slack::Web::Client.new
    //           slack.chat_postMessage(channel: slack_channel, text: message, attachments: attachments, as_user: true)
    //         rescue
    //           puts "Unable to send Slack message to #{slack_channel}"
    //         end
    //       end
    //     end
    //   end
    //
    //   if backup_status == :succeeded
    //     puts "Backup was successful"
    //   else
    //     puts "Backup failed"
    //   end
    // end

    return 0;
  }
}
exports.MongoBackupTool = MongoBackupTool;
//# sourceMappingURL=MongoBackupTool.js.map