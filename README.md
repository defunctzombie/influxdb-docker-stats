# influxdb-docker-stats

Collect docker container stats into InfluxDB. Useful for setting up analytics and monitoring on container data with Influx and Grafana.

## Run

After building the docker container (called influxdb-docker-stats), a sample run command would look like the following.

```shell
docker run --volume=/var/run/docker.sock:/var/run/docker.sock influxdb-docker-stats
```

## Configure

Environment variables configure where stats are collected and how they are tagged.

### INFLUXDB_URL

Set the url where to collect stats for InfluxDB

`http://user:pass@hostname:8086/dbname`

### INFLUXDB_SERIES_NAME

The series name for container data.

Default is `container-stats`

### CONTAINER_NAME_LABEL

If specified, this will use this container label value for the `name` field in each stat record.

Default is the primary container name.
