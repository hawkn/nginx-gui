const fs = require('fs');
const path = require('path');
const LOGGER = require('../utils/logger');
const childProcess = require('child_process');
const fkill = require('fkill');

class NginxService {

    constructor(app, db, ws, startNginx) {
        this.db = db;
        this.nginx = null;

        app.route('/api/nginx/logs/access')
            .get(this.getAccessLog.bind(this))
        ;

        app.route('/api/nginx/servers')
            .get(this.getServers.bind(this))
            .post(this.postServers.bind(this))
        ;

        app.route('/api/nginx/servers/:id')
            .get(this.getServer.bind(this))
            .post(this.postServer.bind(this))
            .delete(this.deleteServer.bind(this))
        ;

        app.route('/api/nginx/run')
            .post(this.runNginx.bind(this))
        ;

        app.route('/api/nginx/running')
            .get(this.isRunning.bind(this))
        ;

        app.route('/api/nginx/kill')
            .post(this.killNginx.bind(this))
        ;

        if (startNginx) {
            this.runNginx();
        }

    }

    getAccessLog(req, res) {
        let accessLogs = fs.readFileSync(path.join(__dirname, '../../logs/json.log')).toString().split('\r\n').reverse();
        res.send(accessLogs.splice(0, accessLogs.length > 1000 ? 1000 : accessLogs.length));
    }

    postServers(req, res) {
        (req.body || []).forEach((server) => {
            this.db.save(this.db.getNginx(), server);
        });
        res.send(this.db.getNginx().data)
    }

    postServer(req, res) {
        if (Number.parseInt(req.params.id, 10) === req.body.$loki) {
            this.db.save(this.db.getNginx(), req.body);
            res.sendStatus(200);
        } else {
            res.sendStatus(400);
        }
    }

    deleteServer(req, res) {
        const serverToRemove = this.db.getNginx().data.find((server) => server.$loki === Number.parseInt(req.params.id, 10));
        this.db.remove(this.db.getNginx(), serverToRemove);
        res.send(this.db.getNginx().data)
    }

    getServers(req, res) {
        res.send(this.db.getNginx().data)
    }

    getServer(req, res) {
        res.send(this.db.getNginx().data.find((server) => server.$loki === Number.parseInt(req.params.id, 10)));
    }

    runNginx(req, res) {
        try {
            if (this.nginx) {
                LOGGER.error('Nginx is already running');
                if (res) {
                    res.send({
                        date: new Date(),
                        log: 'Nginx is already running',
                        status: 'error'
                    });
                }
                return;
            }
            const confFile = path.join(__dirname, '../../nginx/conf/nginx.tmp.conf');
            const serversToStart = this.db.getNginx().data
                .filter((server) => server.enable);
            fs.writeFileSync(confFile, `
events {
    worker_connections  1024;
}


http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;

    keepalive_timeout  65;
    log_format json_logs '{"remote_addr":"$remote_addr" , "remote_user" : "$remote_user", "time_local" : "$time_local", '
                       '"proxy_host":"$proxy_host", "request": "$request", "status": "$status", "body_bytes_sent": "$body_bytes_sent", '
                       ' "http_referrer" : "$http_referer", "http_user_agent" : "$http_user_agent"}';

    ${serversToStart
                .map((server) => server.conf)
                .reduce((a, b) => a + '\r\n' + b)}
}`);
            this.nginx = childProcess.spawn(path.join(__dirname, '../../nginx/nginx.exe'), ['-c', confFile], {
                cwd: path.join(__dirname, '../../')
            });
            LOGGER.debug('Running nginx with PID : ', this.nginx.pid);
            this.nginx.stdout.on('data', (d) => LOGGER.debug('stdout', d.toString()));
            this.nginx.stderr.on('data', (d) => {
                LOGGER.debug('stderr', d.toString());
                this.nginx = null;
            });
            this.nginx.on('message', (d) => GGER.debug('message', (d || '').toString()));

            if (res) {
                res.send({
                    date: new Date(),
                    log: 'Started servers : ' + serversToStart.map((server) => server.displayName).join(','),
                    status: 'success'
                });
            }
        } catch (e) {
            this.nginx = null;
            if (res) {
                res.send({
                    date: new Date(),
                    log: 'Error starting server : ' + e,
                    status: 'error'
                });
            }
        }
    }

    killNginx(req, res) {
        try {
            if (this.nginx) {
                this.nginx.on('close', (d) => {
                    LOGGER.debug('closed', this.nginx.pid, 'with result =>', (d || '').toString());
                    this.nginx = null;
                    res.send({
                        date: new Date(),
                        log: 'Killed nginx',
                        status: 'success'
                    });
                });
                fkill(this.nginx.pid, {tree: true, force: true});
            } else {
                res.sendStatus(204);
            }
        } catch (e) {
            res.send({
                date: new Date(),
                log: 'Nginx isn\'t running',
                status: 'error'
            })
        }
    }

    isRunning(req, res) {
        if (this.nginx) {
            res.send(true);
        } else {
            res.send(false)
        }
    }
}

module.exports = {
    NginxService
};
