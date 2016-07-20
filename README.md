# NetForest 
Elasticsearch Plugin to Monitor the Cluster Health and Nodes on a Machine.
# Installation (Windows)
--> Go to Elasticsearch bin directory and open Command Window

--> Type `plugin install arjungulzzz/netforest/<Latest Release>` Example: NetForest v0.1

--> In the Browser Window, run: 
>Host Running Elasticsearch/_plugin/netforest 

Example: localhost:9200/_plugin/netforest

# Monitoring 

Enter the "host running elasticsearch and refresh interval in seconds". Save the Config
 
![alt text](https://github.com/arjungulzzz/netforest/blob/master/snaps/snap3.png "elasticsearch")


Cluster name shown as :

![alt text](https://github.com/arjungulzzz/netforest/blob/master/snaps/snap1.png "elasticsearch")

Color of Cluster name is represented by the Cluster Health viz Red, Yellow, Green.

Nodes given by d3 :

![alt text](https://github.com/arjungulzzz/netforest/blob/master/snaps/snap2.png "elasticsearch")

Disk Space on Y-axis

The nodes section will show a bar chart of available disk on each node. The bars are color coded as follows:

1. Gray — Free disk space on node
2. Brown — Disk used on node for everything but Elasticsearch
3. Blue — Disk used by Elasticsearch (all shards green)
4. Yellow — Disk used by Elasticsearch (some shards on node is in a relocating state)
5. Orange — Disk used by Elasticsearch (some shards on node is in a recovery / initializing state)

The Table below the Nodes shows the Total accumulated Stats of Current Cluster
