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
    af-streams* | af-streams:*
    af-streams:sql     - Portion SQL
    af-streams:ltr     - LastTimeRecords
    af-streams:lnp     - before & after load next portion
    af-streams:stream  
          - vt: <2019-01-19T11:34:27.000+03:00> loaded/skipped/used: 34041/1/34040 
          - SENT: r: 34040 / 01-17 17:00:11.620 - 14:45:05.940 / 78294320 ms /  34040b / r.tot:  65763       BUFFER empty  
    af-streams:alerts

    SingleEventTimeWindow
    TimeWindow
    KeyedNumberWindow
    KeyedSingleEventTimeWindow
    KeyedTimeWindow

