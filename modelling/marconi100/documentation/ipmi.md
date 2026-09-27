# IPMI
The IPMI plugin collects all the sensor data provided by the OOB management interface (BMC) of cluster nodes.

## Plugin-specific columns

|Column|Description|
|------|-----------|
|node|The hostname of the server|

## Metrics
|Metric|Description|Unit (ExaMon)|Unit (doc)|Value type|Sampling period|
|------|-----------|-------------|----------|----------|---------------|
|ambient|Temperature at the node inlet|degreesC|°C|float|20s (per node)|
|dimmX_temp|Temperature of DIMM module n. X. X=0..15|degreesC|°C|int|20s (per node)|
|fanX_Y|Speed of the Fan Y in module X. X=0..3, Y=0,1|revolutions|RPM|int|20s (per node)|
|fan_disk_power|Power consumption of the disk fan|Watts|W|int|20s (per node)|
|gpuX_core_temp|Temperature of the core for the GPU id X. X=0,1,3,4|degreesC|°C|int|20s (per node)|
|gpuX_mem_temp|Temperature of the memory for the GPU id X. X=0,1,3,4|degreesC|°C|int|20s (per node)|
|gv100cardX|X=0..3|unspecified||int|20s (per node)|
|pX_coreY_temp|Temperature of core n. Y in the CPU socket n. X. X=0..1, Y=0..23|degreesC|°C|int|20s (per node)|
|pX_io_power|Power consumption for the I/O subsystem for the CPU socket n. X. X=0..1|Watts|W|int|20s (per node)|
|pX_mem_power|Power consumption for the memory subsystem for the CPU socket n. X. X=0..1|Watts|W|int|20s (per node)|
|pX_power|Power consumption for the CPU socket n. X. X=0..1|Watts|W|int|20s (per node)|
|pX_vdd_temp|Temperature of the voltage regulator for the CPU socket n. X. X=0..1|degreesC|°C|int|20s (per node)|
|pcie|Temperature at the PCIExpress slots|degreesC|°C|float|20s (per node)|
|psX_input_power|Power consumption at the input of power supply n. X. X=0..1|Watts|W|int|20s (per node)|
|psX_input_voltag|Voltage at the input of power supply n. X. X=0..1|Volts|V|int|20s (per node)|
|psX_output_curre|Current at the output of power supply n. X. X=0..1|Amps|A|int|20s (per node)|
|psX_output_volta|Voltage at the output of power supply n. X. X=0..1|Volts|V|float|20s (per node)|
|total_power|Total node power consumption|Watts|W|int|20s (per node)|