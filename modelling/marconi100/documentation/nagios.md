# Nagios
This plugin interfaces with a Nagios extension developed by CINECA called "Hnagios", collects and translates the data payload to the ExaMon data model.

## Plugin-specific columns

|Column|Description|
|------|-----------|
|description|Name of the entity (HW/SW) monitored by Nagios|
|host_group|Label defining groups of nodes sharing the same function|
|nagiosdrained|Flag indicating that the node on which the specific alarm occurred was drained (placed offline) manually by an operator|
|node|The hostname of the server|
|state_type|Number indicating the state type of the host or service when the event handler was run. 0 = SOFT state; 1 = HARD state|

### Description (tag)

|Value|Description|
|-----|-----------|
|alive::ping|The node is network reachable via ICMP|
|backup::local::status|The status of the backup of management node is current|
|batchs::client|The batch system client daemon in compute nodes is up & run|
|batchs::client::serverrespond|The batch scheduler server is responding to queries|
|batchs::client::state|The compute node batch client is in a good shape able to schedule jobs (in the view of the batch scheduler server)|
|batchs::manager::state|The batch scheduler server is available|
|bmc::events|The node’s bmc processor has reported critical events|
|cluster::status::availability|The status summary related to the availability (available nodes/total nodes) of the entire platform|
|cluster::status::criticality|The status summary related to the critical nodes (nodes not properly working not yet under repair/total nodes) of the entire platform|
|cluster::status::internal|Checks the above values are properly calculated|
|cluster::status::wattage|The total IT energy power absorbed is in a given range|
|cluster::us::availability|The status summary related to the availability (available nodes/total nodes) of the entire platform at the end of a maintenance. Another view of the cluster::status::* not useful|
|cluster::us::criticality|The status summary related to the critical nodes (nodes not properly working not yet under repair/total nodes) of the entire platform. Another view of the cluster::status::* not useful|
|container::check::health|The status of the “general services” provided via containers|
|container::check::internal||
|container::check::mounts|The availability of the shared mount points binded to the containers runtime.|
|crm::resources::m100|Status of the resources managed via Pacemaker/Corosync HA cluster management system|
|crm::status::m100|Status of the cluster managed via Pacemaker/Corosync HA cluster management system|
|dev::raid::status|Status of the storage raid controller/resources|
|dev::swc::confcheck|Status of the current configuration of the network switches (unwanted/unmanaged changes)|
|dev::swc::confcheckself|Status of completeness of the previous one|
|dev::swc::cumulusensors|Sensor readings and related thresholds checks for Cumulus OS based network switches|
|dev::swc::cumulushealth|Healthiness of the Cumuls OS based network switches|
|dev::swc::cumulussensors|The same as dev::swc::cumulusensors|
|dev::swc::hwcheck|Healthiness of network switches (hw failures)|
|dev::swc::isl|Status of the network inter switch links/ports|
|dev::swc::mlxhealth|Healthiness of the Mellanox OS based network switches|
|dev::swc::mlxsensors|Sensor readings and related thresholds checks for Mellanox OS based network switches|
|file::integrity|Local file system data coherency|
|filesys::dres::mount|Shared file system mount availability|
|filesys::eurofusion::mount|Shared file system mount availability|
|filesys::local::avail|Local filesystem capability|
|filesys::local::mount|Local filesystem mount availability|
|filesys::shared::mount|Shared file system mount availability|
|firewalld::status|Firewalld daemon readiness and effectiveness|
|galera::status::Integrity|Galera cluster Integrity|
|galera::status::NodeStatus|Galera cluster nodes availability|
|galera::status::ReplicaStatus|Galera cluster replica effectiveness|
|globus::gridftp|Globus gridftp daemon status|
|globus::gsissh|Globus gsissh daemon status|
|memory::phys::total|Physical memory availability|
|monitoring::health|Coherency in monitored/under maintenance/under repair nodes|
|net::ib::status|Infiniband HCA readiness and effectiveness|
|nfs::rpc::status|Remote NFS export source readiness|
|nvidia::configuration|Nvidia GPGPU configuration status|
|nvidia::memory::replace|Nvidia GPGPU memory degraded to be replaced|
|nvidia::memory::retirement|Nvidia GPGPU memory degraded status|
|service::cert|Validity of TLS certificates|
|service::galera|Galera cluster integrity and replica status|
|service::galera:arbiter|Galera cluster arbiter status|
|service::galera:mysql|Mysql daemon readiness|
|ssh::daemon|SSH service is responding to connections|
|sys::corosync::rings|Status of the corosync rings in a cluster managed via Pacemaker/Corosync HA cluster management system|
|sys::gpfs::status|Status of the GPFS daemon services in a node|
|sys::pacemaker::crm|Status of the resources managed via Pacemaker/Corosync HA cluster management system|
|sys::rvitals|Status of the BMC controller sensors and related thresholds|
|sys::sssd::events|Status of the System Security Service Daemon|
|sys::xcatpod::sync|Synchronization status of the management system|
|unicore::tsi|Unicore TSI service is up & running|
|unicore::uftpd|Unicore UFTPD service is up & running|
|vm::virsh::state|Virtual Machine status as seen by hypervisor|

## Metrics

|Metric|Description|Value type|Sampling period|
|------|-----------|----------|---------------|
|state|Current status of the monitored service/resource. Follows the Nagios state encoding. For host event handlers: 0 = UP 1 = DOWN 2 = UNREACHABLE; for service event handlers: 0 = OK 1 = WARNING 2 = CRITICAL 3 = UNKNOWN|int|15m (per node and description)|