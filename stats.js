var fs = require('fs');
var debug = require('debug')('docker-stats');
var Docker = require('dockerode');
var Stats = require('influx-collector');
var EventEmitter = require('events').EventEmitter;
var difference = require('lodash.difference');

var INFLUXDB_URL = process.env.INFLUXDB_URL;
var SERIES_NAME = process.env.INFLUXDB_SERIES_NAME || 'container-stats';

// if set, determine which label to use for the container name
// otherwise first item in Names will be used
var CONTAINER_NAME_LABEL = process.env.CONTAINER_NAME_LABEL;

var stats = Stats(INFLUXDB_URL);

stats.on('error', function(err) {
    console.error(err.stack);
});

var docker = new Docker();

// container id -> stats collector
var monitoring_containers = Object.create(null);

(function load_containers() {
    docker.listContainers(function (err, containers) {
        if (err) {
            return console.error(err.stack);
        }

        var current_ids = containers.map(function(container) {
            return container.Id;
        });

        // see which ids are no longer relevant
        // stop collecting those
        var existing = Object.keys(monitoring_containers);

        var removed = difference(existing, current_ids);
        removed.forEach(function(id) {
            debug('removing container %s', id);
            var monitor = monitoring_containers[id];
            monitor.stop();
            delete monitoring_containers[id];
        });

        containers.forEach(function(container) {
            var id = container.Id;
            if (id in monitoring_containers) {
                return;
            }

            debug('monitoring container %s', id);
            var monitor = monitoring_containers[id] = Monitor(id, container);
            monitor.on('error', function(err) {
                // container not found, remove it
                if (err.statusCode === 404) {
                    debug('removing container %s', id);
                    var monitor = monitoring_containers[id];
                    monitor.stop();
                    delete monitoring_containers[id];
                }
            });
        });

        // container.Labels {}
        // container.Names []
        // has labels via container.Labels
        setTimeout(load_containers, 5000);
    });
})();

function Monitor(container_id, container_info) {
    if (!(this instanceof Monitor)) {
        return new Monitor(container_id, container_info);
    }

    var self = this;
    self._active = false;
    self._container = docker.getContainer(container_id);

    // datapoint name for the container
    self._name = (container_info.Labels || {})[CONTAINER_NAME_LABEL];
    if (!self._name && container_info.Names.length > 0) {
        self._name = container_info.Names[0];
    }
    self._name = self._name || 'unknown';

    self.start();
}

Monitor.prototype.__proto__ = EventEmitter.prototype;

Monitor.prototype.start = function() {
    var self = this;

    if (self._active) {
        return;
    }
    self._active = true;

    (function get_new_stats() {
        if (!self._active) {
            return;
        }

        self._stats(function(err, stat) {
            if (err) {
                self.emit('error', err);
                return;
            }

            //debug('new stats %s %j', self._container.id, stat);
            self._collect(stat);
            setTimeout(get_new_stats, 2000);
        });
    })();
};

Monitor.prototype.stop = function() {
    var self = this;
    self._active = false;
    self.removeAllListeners();
};

Monitor.prototype._stats = function(cb) {
    var self = this;
    self._container.stats(function(err, stats) {
        if (err) {
            return cb(err);
        }

        stats.on('data', function(chunk) {
            var stat = JSON.parse(chunk.toString());
            stats.destroy();
            cb(null, stat);
        });
    });
};

Monitor.prototype._collect = function(stat) {
    var self = this;

    var network = stat.network;
    var cpu = stat.cpu_stats;
    var memory = stat.memory_stats;

    stats.collect(SERIES_NAME, {
        name: self._name,
        // network
        'network.rx_bytes': network.rx_bytes,
        'network.rx_packets': network.rx_packets,
        'network.rx_errors': network.rx_errors,
        'network.rx_dropped': network.rx_dropped,
        'network.tx_bytes': network.tx_bytes,
        'network.tx_packets': network.tx_packets,
        'network.tx_errors': network.tx_errors,
        'network.tx_dropped': network.tx_dropped,

        // cpu
        'cpu.usage.total': cpu.cpu_usage.total_usage,
        'cpu.usage.kernel': cpu.cpu_usage.usage_in_kernelmode,
        'cpu.usage.user': cpu.cpu_usage.usage_in_usermode,
        'cpu.system': cpu.system_cpu_usage,

        // memory
        'memory.usage': memory.usage,
        'memory.max': memory.max_usage,
        'memory.limit': memory.limit,
    });
};
