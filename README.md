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

    af-stream:sql     - Portion SQL
    af-stream:ltr     - LastTimeRecords
    af-stream:lnp     - before & after load next portion
    af-stream:stream  
          - vt: <2019-01-19T11:34:27.000+03:00> loaded/skipped/used: 34041/1/34040 
          - SENT: r: 34040 / 01-17 17:00:11.620 - 14:45:05.940 / 78294320 ms /  34040b / r.tot:  65763       BUFFER empty  
