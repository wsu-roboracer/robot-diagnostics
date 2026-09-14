# Robot Diagnostics

Robot Diagnostics is a project for the Weber State University RoboRacer platform.

The goal of this project is to make it easier to understand the current health of the robot and quickly identify problems with its different subsystems.

## What This Project Does

The RoboRacer has several hardware and software components that need to work together correctly.

When something fails, it can take time to figure out what is causing the problem. A user may need to manually check ROS nodes, sensors, network connections, controllers, battery information, cameras, or other hardware.

This project is being developed to bring that information together into one diagnostic system.

The system should help users answer questions such as:

- Is the robot connected to the network?
- Are the required ROS nodes running?
- Is the controller connected?
- Is the camera working?
- Is the LiDAR available?
- What is the battery status?
- Which subsystem is causing a problem?

## Who This Is For

This project is intended for people who work with the Weber State RoboRacer platform, including:

- Students using the robots in labs
- Instructors setting up and troubleshooting the robots
- Researchers working with the RoboRacer platform
- Developers working on RoboRacer software and hardware

## Problem We Are Solving

Troubleshooting the RoboRacer currently requires checking different parts of the system separately.

This can make it difficult to quickly determine whether a problem is caused by software, networking, sensors, hardware, or another subsystem.

The goal of Robot Diagnostics is to provide an at-a-glance view of the robot's condition so users know where to begin troubleshooting.

Subsystems may report states such as:

- Healthy
- Degraded
- Failed
- Unknown

An `Unknown` state means the system cannot currently determine the condition of that subsystem. It does not automatically mean the subsystem has failed.

## Current Status

The project is currently in the research, design, and early prototype stage.

Current work includes:

- Researching common RoboRacer failure modes
- Identifying important robot subsystems
- Defining subsystem health states
- Researching ROS status information
- Designing and testing dashboard mockups
- Building an early diagnostic prototype
- Deciding how diagnostic information should be presented

The final architecture is still being evaluated.

Possible approaches include:

- Web application
- Status server
- Physical status indicator

Architecture decisions will be documented in `docs/adr/`.

## Repository Structure

```text
robot-diagnostics/
├── docs/
│   └── adr/
├── Engineering_Logs/
├── Images/
├── prototype/
├── scripts/
├── src/
├── tests/
└── README.md