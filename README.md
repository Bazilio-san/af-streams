# Data stream from database table

Generates a data stream from a database table.

The table must have a timestamp field and a set of fields as part of the primary key.


### Used databases

- mssql
- postgres


### Senders

- Console
- Callback function
- Event emitter
- TCP JSON sender in binary format of WSO2 events
- Websocket JSON sender

## Debug IDs

    af-streams:sql     - Portion SQL
    af-streams:ltr     - LastTimeRecords
    af-streams:lnp     - before & after load next portion
    af-streams:stream  
          - vt: <2019-01-19T11:34:27.000+03:00> loaded/skipped/used: 34041/1/34040 
          - SENT: r: 34040 / 01-17 17:00:11.620 - 14:45:05.940 / 78294320 ms /  34040b / r.tot:  65763       BUFFER empty  

## ENV
```shell
STREAM_START_TIME= # - ISO time in GMT
STREAM_START_BEFORE= # - milliseconds | <N years?|y|months?|mo|weeks?|w|days?|d|hours?|h|minutes?|min|m|seconds?|sec|s|milliseconds?|millis|ms>>
STREAM_FETCH_INTERVAL_SEC=10
STREAM_SPEED=1
STREAM_BUFFER_MULTIPLIER=2
STREAM_MAX_BUFFER_SIZE=65000
STREAM_SEND_INTERVAL_MILLIS=10
STREAM_MAX_RUNUP_FIRST_TS_VT_MILLIS=2_000
STREAM_SKIP_GAPS=false
STREAM_LOOP_TIME_MILLIS=
STREAM_PRINT_INFO_INTERVAL_SEC=60
STREAM_REDIS_HOST=
STREAM_REDIS_PORT=6379
STREAM_USE_START_TIME_FROM_REDIS_CACHE=true
STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS=5
STREAM_SPEED_CALC_INTERVAL_SEC=10
```
