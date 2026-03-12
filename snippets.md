# Bentley CFG Snippets Reference

All snippets are available in `.cfg`, `.ucf`, and `.pcf` files. Trigger any snippet by typing one of its **prefixes** and selecting it from the IntelliSense list. Tab stops (`$1`, `$2`, …) let you jump between editable fields; choice fields drop down a selection list.

---

## Table of Contents

1. [File Structure](#1-file-structure)
2. [Configuration Level](#2-configuration-level)
3. [Include & Conditional](#3-include--conditional)
4. [Variable Assignment](#4-variable-assignment)
5. [Variable References](#5-variable-references)
6. [System Path Variables](#6-system-path-variables)
7. [MicroStation Standard Variables](#7-microstation-standard-variables)
8. [Configuration Templates](#8-configuration-templates)
9. [Advanced Control](#9-advanced-control)
10. [DMWF (Dynamic Managed Workspace Framework)](#10-dmwf-dynamic-managed-workspace-framework)

---

## 1. File Structure

### CFG File Header

**Prefixes:** `hdr`, `header`, `cfgheader`

Inserts a standard file header block with author, date, and level fields.

```cfg
#----------------------------------------------------------------------
# FileName.cfg
#
# Description
#
# Author  : Your Name
# Created : 2026-03-12
# Modified: 2026-03-12
#
# Level   : WorkSpace          ← choice: WorkSpace | WorkSet | Organization | System | Application | Role | User
#----------------------------------------------------------------------
```

---

### Section Separator Comment

**Prefixes:** `sep`, `section`, `divider`

Inserts a visual section separator with a label.

```cfg
#----------------------------------------------------------------------
# Section Name
#----------------------------------------------------------------------
```

---

## 2. Configuration Level

### Set Level

**Prefixes:** `%level`, `level`

Sets the processing level for the current file. Numeric levels 0–6 or named levels are available from a dropdown.

```cfg
%level WorkSpace
```

*Choices:* `0` `1` `2` `3` `4` `5` `6` `WorkSpace` `WorkSet` `Organization` `System` `Application` `Role` `User`

---

## 3. Include & Conditional

### Include File

**Prefixes:** `%include`, `include`

Simple `%include` directive with a path placeholder.

```cfg
%include $(_USTN_WORKSPACEROOT)filename.cfg
```

---

### Include with Level

**Prefixes:** `includelevel`, `includelvl`

`%include` with an explicit level override chosen from a dropdown.

```cfg
%include $(_USTN_ORGANIZATION)Standards.cfg level Organization
```

*Level choices:* `WorkSpace` `WorkSet` `Organization` `System` `Application` `Role` `User`

---

### If Exists Include

**Prefixes:** `ifexists`, `existsinclude`, `safeinclude`

Safely includes a file only when it exists — prevents errors from missing optional files.

```cfg
%if exists ($(_USTN_WORKSPACEROOT)filename.cfg)
%  include $(_USTN_WORKSPACEROOT)filename.cfg
%endif
```

---

### If Exists Include with Level

**Prefixes:** `ifexistsinclude`, `safeincludelevel`

Safe include with a level override.

```cfg
%if exists ($(_USTN_WORKSPACEROOT)filename.cfg)
%  include $(_USTN_WORKSPACEROOT)filename.cfg level WorkSpace
%endif
```

---

### Wildcard Include

**Prefixes:** `wildinclude`, `includeall`

Includes all `.cfg` files found in a directory (if the directory exists).

```cfg
%if exists ($(_USTN_WORKSPACEROOT)*.cfg)
%  include $(_USTN_WORKSPACEROOT)*.cfg level WorkSpace
%endif
```

---

### If Defined

**Prefixes:** `%ifdef`, `ifdefined`, `ifdef`

Conditional block that executes only when a variable is defined.

```cfg
%ifdef VARIABLE_NAME

%endif
```

---

### If Not Defined

**Prefixes:** `%ifndef`, `ifnotdefined`, `ifndef`

Conditional block that executes only when a variable is **not** defined.

```cfg
%ifndef VARIABLE_NAME

%endif
```

---

### If Defined with Else

**Prefixes:** `ifdefelse`, `ifdefinedelse`

Full `%ifdef` / `%else` / `%endif` block.

```cfg
%ifdef VARIABLE_NAME

%else

%endif
```

---

### If Exists

**Prefixes:** `%if exists`, `ifexists`

Conditional block that checks for the existence of a file or path.

```cfg
%if exists (path/to/file)

%endif
```

---

### If Exists Else

**Prefixes:** `ifexistselse`

Full `%if exists` / `%else` / `%endif` block.

```cfg
%if exists (path/to/file)

%else

%endif
```

---

### If Defined And Exists

**Prefixes:** `ifdefinedexists`, `ifdefexists`

Combined check — variable must be defined **and** the resulting path must exist.

```cfg
%if defined (VARIABLE_NAME) && exists ($(VARIABLE_NAME)filename)

%endif
```

---

## 4. Variable Assignment

### Assign Variable

**Prefixes:** `var`, `assign`, `set`

Simple variable assignment.

```cfg
VARIABLE_NAME = value
```

---

### Append to Path Variable

**Prefixes:** `append`, `appendpath`, `addpath`

Appends a path to an existing path variable using the `>` operator.

```cfg
MS_RFDIR > $(_USTN_WORKSETROOT)references/
```

---

### Prepend to Path Variable

**Prefixes:** `prepend`, `prependpath`

Prepends a path to the front of an existing path variable using the `<` operator.

```cfg
MS_RFDIR < $(_USTN_WORKSETROOT)references/
```

---

### Assign If Not Defined

**Prefixes:** `setifnot`, `assignifnotdefined`, `default`

Assigns a value only if the variable has not already been set (`:` operator). Useful for setting defaults that a higher-priority level can override.

```cfg
VARIABLE_NAME : default_value
```

---

### Lock Variable

**Prefixes:** `%lock`, `lock`

Prevents a variable from being changed by any subsequently processed configuration file.

```cfg
%lock VARIABLE_NAME
```

---

### Undefine Variable

**Prefixes:** `%undef`, `undefine`, `clear`

Clears (undefines) a variable entirely.

```cfg
%undef VARIABLE_NAME
```

---

### Define Macro

**Prefixes:** `%define`, `define`, `macro`

Defines a macro flag (no value — used with `%ifdef` / `%ifndef`).

```cfg
%define MACRO_NAME
```

---

## 5. Variable References

### Variable Reference (Deferred)

**Prefixes:** `ref`, `varref`, `$()`

Inserts a deferred `$()` reference. The variable is resolved each time it is used, picking up any changes made after the line was processed.

```cfg
$(VARIABLE_NAME)
```

---

### Variable Reference (Immediate)

**Prefixes:** `refnow`, `varrefimmediate`, `${}`

Inserts an immediate `${}` reference. The variable is resolved once at the point the line is processed and the result is frozen.

```cfg
${VARIABLE_NAME}
```

---

## 6. System Path Variables

### WorkSpace Root Path

**Prefixes:** `wsroot`, `workspaceroot`

Reference to the workspace root directory with an optional subfolder.

```cfg
$(_USTN_WORKSPACEROOT)subfolder/
```

---

### WorkSet Root Path

**Prefixes:** `wstroot`, `worksetroot`

Reference to the workset root directory with an optional subfolder.

```cfg
$(_USTN_WORKSETROOT)subfolder/
```

---

### WorkSpace Standards Path

**Prefixes:** `wsstandards`, `workspacestandards`

Reference to the workspace standards directory.

```cfg
$(_USTN_WORKSPACESTANDARDS)subfolder/
```

---

### Organization Path

**Prefixes:** `orgpath`, `organization`

Reference to the organization-level directory.

```cfg
$(_USTN_ORGANIZATION)subfolder/
```

---

### App Standards Path

**Prefixes:** `appstd`, `appstandards`

Reference to the application standards directory (e.g. ORD/OpenRoads delivered content).

```cfg
$(APP_STANDARDS)subfolder/
```

---

## 7. MicroStation Standard Variables

### Design Seed

**Prefixes:** `designseed`, `seed`, `msseed`

Sets the design seed file path.

```cfg
MS_DESIGNSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed3d.dgn
```

---

### Reference File Directory

**Prefixes:** `rfdir`, `refsdir`, `references`

Sets, appends (`>`), or prepends (`<`) a reference file search directory.

```cfg
MS_RFDIR > $(_USTN_WORKSETROOT)References/
```

*Operator choices:* `=` `>` `<`

---

### ProjectWise VBA Search Directories

**Prefixes:** `pwvba`, `vbapw`, `vbasearch`

Bentley-recommended pattern for ProjectWise VBA macro search and copy-out directories.

```cfg
MS_VBASEARCHDIRECTORIES > $(CIVIL_ORGANIZATION_STANDARDS)Macros/
MS_VBACOPYOUT = $(MS_VBASEARCHDIRECTORIES)
```

---

### Drawing Seeds DGNLib Reset

**Prefixes:** `drawingseeds`, `dgnlibseeds`, `seedsreset`

Resets and then re-appends drawing seed DGN libraries, separating delivered seeds from custom ones.

```cfg
MS_DGNLIBLIST > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/*.dgnlib
MS_DGNLIBLIST_DRAWINGSEEDS = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/*.dgnlib
MS_DGNLIBLIST_DRAWINGSEEDS > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/Details/*.dgnlib
```

---

### Reports Directories Stack

**Prefixes:** `reportsdirs`, `civilreports`, `iowareports`

Full pattern for loading delivered ORD report directories then layering custom reports on top.

```cfg
# Load Local Default Reports Directories (ORD Install Folder)
CIVIL_REPORTS_SUBDIRECTORIES = $(_ROOTDIR)Default/Reports/Cant
CIVIL_REPORTS_SUBDIRECTORIES > $(_ROOTDIR)Default/Reports/CivilGeometry
CIVIL_REPORTS_SUBDIRECTORIES > $(_ROOTDIR)Default/Reports/CivilSurvey
# Load Custom Reports
MS_VBACOPYOUT = $(CIVIL_ORGANIZATION_STANDARDS)Reports/
CIVIL_REPORTS_RESOURCES < $(CIVIL_ORGANIZATION_STANDARDS)Reports/
CIVIL_REPORTS_SUBDIRECTORIES < $(CIVIL_ORGANIZATION_STANDARDS)Reports/Custom/
```

---

### Quick Print Performance

**Prefixes:** `quickprint`, `printperf`, `pltperf`

Bentley-recommended settings for improved print performance.

```cfg
MS_PLT_MAX_WORKER_TASKS = 2000
CIVIL_ENABLE_QUICK_PRINTSERVER = 1
```

---

### Cell Library

**Prefixes:** `celllist`, `cells`, `celllib`

Sets, appends, or prepends a cell library path.

```cfg
MS_CELLLIST > $(_USTN_WORKSPACESTANDARDS)Cell/cells.cel
```

*Operator choices:* `=` `>` `<`

---

### DGN Library

**Prefixes:** `dgnlib`, `dgnliblist`

Sets, appends, or prepends a DGN library path.

```cfg
MS_DGNLIB > $(_USTN_WORKSPACESTANDARDS)Dgnlib/standards.dgnlib
```

*Operator choices:* `=` `>` `<`

---

### Template Library

**Prefixes:** `templatelib`, `templates`, `civiltemplate`

Sets the civil roadway template library path for OpenRoads Designer.

```cfg
CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/$(_USTN_WORKSPACENAME).itl
```

---

### Plot Files Directory

**Prefixes:** `plotfiles`, `plots`, `output`

Sets the plot output directory.

```cfg
MS_PLOTFILES = $(_USTN_WORKSETROOT)Output/Plots/
```

---

### Print Organizer

**Prefixes:** `printorganizer`, `printorg`

Sets the Print Organizer search directory.

```cfg
MS_PRINT_ORGANIZER = $(_USTN_WORKSPACESTANDARDS)PrintOrganizer/
```

---

### Linestyle Resource

**Prefixes:** `linestyle`, `linestyles`

Sets, appends, or prepends a linestyle resource file.

```cfg
MS_LINESTYLE > $(_USTN_WORKSPACESTANDARDS)Linestyle/linestyles.rsc
```

*Operator choices:* `=` `>` `<`

---

### MDL Applications

**Prefixes:** `mdlapps`, `mdl`

Sets, appends, or prepends an MDL application search directory.

```cfg
MS_MDLAPPS > $(_USTN_WORKSPACEROOT)Mdlapps/
```

*Operator choices:* `=` `>` `<`

---

### Macros Directory

**Prefixes:** `macros`, `vbamacros`

Sets, appends, or prepends a VBA macros search directory.

```cfg
MS_MACROS > $(_USTN_WORKSPACEROOT)Macros/
```

*Operator choices:* `=` `>` `<`

---

## 8. Configuration Templates

These snippets insert complete, ready-to-use CFG file skeletons with all the key sections in place.

---

### WorkSpace CFG Template

**Prefixes:** `workspace-cfg`, `wscfg`, `newworkspace`

Complete WorkSpace-level CFG with commented-out redirects for root, standards, and worksets root directories.

```cfg
#----------------------------------------------------------------------
# WorkSpaceName.cfg - WorkSpace Configuration
#
# Defines the location of this WorkSpace's root, standards,
# and WorkSets root directories.
#----------------------------------------------------------------------

%level WorkSpace

#----------------------------------------------------------------------
# Redirect WorkSpace to network location
#----------------------------------------------------------------------
# _USTN_WORKSPACEROOT = $(NETWORK_ROOT)$(_USTN_WORKSPACENAME)/

#----------------------------------------------------------------------
# Redirect Standards
#----------------------------------------------------------------------
# _USTN_WORKSPACESTANDARDS = $(_USTN_WORKSPACEROOT)Standards/

#----------------------------------------------------------------------
# Redirect WorkSets Root
#----------------------------------------------------------------------
# _USTN_WORKSETSROOT = $(_USTN_WORKSPACEROOT)WorkSets/
```

---

### WorkSet CFG Template

**Prefixes:** `workset-cfg`, `wstcfg`, `newworkset`

Complete WorkSet-level CFG with project seed, reference directories, and output path sections.

```cfg
#----------------------------------------------------------------------
# WorkSetName.cfg - WorkSet Configuration
#
# Project-specific configuration for WorkSetName
# Created: 2026-03-12
#----------------------------------------------------------------------

%level WorkSet

#----------------------------------------------------------------------
# Project-specific Design Seed
#----------------------------------------------------------------------
# MS_DESIGNSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed3d.dgn

#----------------------------------------------------------------------
# Project-specific Reference Directories
#----------------------------------------------------------------------
MS_RFDIR > $(_USTN_WORKSETROOT)References/

#----------------------------------------------------------------------
# Project Output
#----------------------------------------------------------------------
MS_PLOTFILES = $(_USTN_WORKSETROOT)Output/
```

---

### Organization CFG Template

**Prefixes:** `org-cfg`, `orgcfg`, `standards-cfg`

Complete Organization-level standards CFG covering seeds, cells, dgnlibs, linestyles, and references.

```cfg
#----------------------------------------------------------------------
# Standards.cfg - Organization Configuration
#
# Company-wide configuration for Organization Name
# Applies to all WorkSpaces and WorkSets
#----------------------------------------------------------------------

%level Organization

#----------------------------------------------------------------------
# Design Seeds
#----------------------------------------------------------------------
MS_DESIGNSEED = $(_USTN_ORGANIZATION)Seed/seed3d.dgn

#----------------------------------------------------------------------
# Cell Libraries
#----------------------------------------------------------------------
MS_CELLLIST > $(_USTN_ORGANIZATION)Cell/

#----------------------------------------------------------------------
# DGN Libraries
#----------------------------------------------------------------------
MS_DGNLIB > $(_USTN_ORGANIZATION)Dgnlib/

#----------------------------------------------------------------------
# Line Styles
#----------------------------------------------------------------------
MS_LINESTYLE > $(_USTN_ORGANIZATION)Linestyle/

#----------------------------------------------------------------------
# Reference File Search Paths
#----------------------------------------------------------------------
MS_RFDIR > $(_USTN_ORGANIZATION)References/
```

---

### WorkSpace Setup CFG Template

**Prefixes:** `workspacesetup`, `wssetup`

`WorkSpaceSetup.cfg` template with custom workspace/workset labels and a network-path-with-fallback pattern for the workspaces root and organization root.

```cfg
#----------------------------------------------------------------------
# WorkSpaceSetup.cfg
#
# Configures the WorkSpace label and root directories
# for Organization Name
#----------------------------------------------------------------------

#----------------------------------------------------------------------
# WorkSpace label for your organization
#----------------------------------------------------------------------
_USTN_WORKSPACELABEL : Client
_USTN_WORKSETLABEL   : Project

#----------------------------------------------------------------------
# Redirect WorkSpaces root to network share
#----------------------------------------------------------------------
%if exists (W:/Bentley/Configuration)
  _USTN_WORKSPACESROOT = W:/Bentley/Configuration/WorkSpaces/
  _USTN_ORGANIZATION   = W:/Bentley/Configuration/Organization/
%else
  _USTN_WORKSPACESROOT = C:/Bentley/Configuration/WorkSpaces/
  _USTN_ORGANIZATION   = C:/Bentley/Configuration/Organization/
%endif
```

---

### ORD Civil Workspace CFG Template

**Prefixes:** `ord-cfg`, `ordcfg`, `civil-cfg`

OpenRoads Designer workspace CFG with guarded template library and design seed blocks using the civil variables, plus a commented feature definitions line.

```cfg
#----------------------------------------------------------------------
# WorkSpaceName.cfg - OpenRoads Designer WorkSpace Configuration
#
# Civil/Road design workspace for WorkSpaceName
# Created: 2026-03-12
#----------------------------------------------------------------------

%level WorkSpace

#----------------------------------------------------------------------
# Civil Template Library
#----------------------------------------------------------------------
CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME = $(_USTN_WORKSPACENAME).itl

%if defined (CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME) && exists ($(APP_STANDARDS)Template Library/$(CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME))
  CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/$(CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME)
%endif

#----------------------------------------------------------------------
# Civil Design Seed
#----------------------------------------------------------------------
CIVIL_WORKSPACE_DESIGNSEED = design_seed3d_road.dgn

%if defined (CIVIL_WORKSPACE_DESIGNSEED) && exists ($(APP_STANDARDS)Seed/$(CIVIL_WORKSPACE_DESIGNSEED))
  MS_DESIGNSEED = $(APP_STANDARDS)Seed/$(CIVIL_WORKSPACE_DESIGNSEED)
%endif

#----------------------------------------------------------------------
# Feature Definitions
#----------------------------------------------------------------------
# CIVIL_FEATUREDEF > $(APP_STANDARDS)Feature Definitions/FeatureDefs.xml
```

---

## 9. Advanced Control

### Network Path Fallback

**Prefixes:** `networkfallback`, `netfallback`, `drivefallback`

Points a variable to a network drive and falls back to a local path when the network path is not reachable.

```cfg
%if exists (W:/Bentley/CONNECTEdition)
  _USTN_CUSTOM_CONFIGURATION = W:/Bentley/CONNECTEdition/Configuration/
%else
  _USTN_CUSTOM_CONFIGURATION = C:/Bentley/CONNECTEdition/Configuration/
%endif
```

---

### Lock and Protect Variable

**Prefixes:** `lockvar`, `protect`

Sets a variable and immediately locks it so no later file can change it.

```cfg
VARIABLE_NAME = value
%lock VARIABLE_NAME
```

---

### Protected Section

**Prefixes:** `protected`, `locksection`

Inserts a clearly labelled protected section header followed by a locked variable assignment.

```cfg
#----------------------------------------------------------------------
# Protected Settings - Do not override below this point
#----------------------------------------------------------------------
VARIABLE_NAME = value
%lock VARIABLE_NAME
```

---

### Display All Config Variables

**Prefixes:** `displayvars`, `showvars`, `debugvars`

Enables the debug display of all configuration variables — useful for troubleshooting the config load chain.

```cfg
_USTN_DISPLAYALLCFGVARS = 1
```

---

### Custom Configuration Root

**Prefixes:** `customconfig`, `customroot`

Points `_USTN_CUSTOM_CONFIGURATION` to a non-default configuration root directory.

```cfg
_USTN_CUSTOM_CONFIGURATION = W:/Bentley/CONNECTEdition/Configuration/
```

---

### Role Configuration File

**Prefixes:** `rolecfg`, `role`

Defines the path to the role-specific CFG file, resolved from the current role name.

```cfg
_USTN_ROLECFG = $(_USTN_WORKSPACEROOT)Roles/$(_USTN_ROLENAME).cfg
```

---

### Capability Flag

**Prefixes:** `capability`, `cap`

Sets or modifies a capability flag. Operator (`=` or `>`) and the flag name are chosen from dropdowns.

```cfg
_USTN_CAPABILITY > -CAPABILITY_LEVELS_CREATE
```

*Operator choices:* `=` `>`
*Flag choices:* `-CAPABILITY_LEVELS_CREATE` `-CAPABILITY_LEVELS_DELETE` `-CAPABILITY_MODELS_CREATE` `+CAPABILITY_LEVELS_CREATE`

---

### Protection Encrypt

**Prefixes:** `encrypt`, `protection`

Sets and locks the file protection/encryption flag.

```cfg
MS_PROTECTION_ENCRYPT = 1
%lock MS_PROTECTION_ENCRYPT
```

*Value choices:* `0` `1`

---

### Design History

**Prefixes:** `designhistory`, `history`

Configures and locks design history permissions for create, delete, commit, and browse operations.

```cfg
MS_DESIGN_HISTORY = create=1;delete=0;commit=1;browse=1
%lock MS_DESIGN_HISTORY
```

*Each flag choices:* `0` `1`

---

### File Exists Check Comment Block

**Prefixes:** `existscheck`, `checkfile`

Includes a file with a descriptive comment above the guard block.

```cfg
# Check for description and include if available
%if exists ($(_USTN_WORKSPACEROOT)filename.cfg)
%  include $(_USTN_WORKSPACEROOT)filename.cfg
%endif
```

---

### Multi-Path Search Setup

**Prefixes:** `multipath`, `searchpaths`

Sets up a layered search path — workset-specific first, then workspace standards, then organization-level.

```cfg
# Primary search paths
MS_RFDIR = $(_USTN_WORKSETROOT)References/
MS_RFDIR > $(_USTN_WORKSPACESTANDARDS)References/
MS_RFDIR > $(_USTN_ORGANIZATION)References/
```

---

## 10. DMWF (Dynamic Managed Workspace Framework)

These snippets support the Bentley Dynamic Managed Workspace Framework (DMWF) used with ProjectWise Managed Workspace configurations.

---

### DMWF: CSB Predefined Template

**Prefixes:** `csb-predefined`, `dmwf-predefined`, `csbpredefined`

Sets the DMWF datasource root and includes the `Common_Predefined.cfg` entry point.

```cfg
# Create variable, then browse to specific ProjectWise Folder
_DYNAMIC_DATASOURCE_BENTLEYROOT : @:Resources\Bentley\
%include $(_DYNAMIC_DATASOURCE_BENTLEYROOT)Common_Predefined.cfg
```

---

### DMWF: WorkArea PWSetup Predefined (CE)

**Prefixes:** `workarea-pwsetup`, `dmwf-workarea`, `workareasetup`

WorkArea-level PWSetup predefined template. Registers this file in `_DYNAMIC_CONFIGS`, validates that V8i is not in use, and sets the workspace group and CE workspace name for CONNECT Edition.

```cfg
_DYNAMIC_CONFIGS > WorkAreaPWSetup_Predefined_XXXX_CE.cfg 24.0.0.0

%if defined (_VERSION_8_11)
    %error This WorkArea not configured for V8i.
%elif defined (_VERSION_10_0)
    _DYNAMIC_WORKSPACEGROUPNAME = ClientName
    _DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = Configuration2024
    _DYNAMIC_CEWORKSPACENAME = CEWorkspaceName
%endif
```

---

### DMWF: Workspace PWSetup Predefined (CE)

**Prefixes:** `workspace-pwsetup`, `dmwf-workspace`, `workspacesetup`

Workspace-level PWSetup predefined template. Resolves the WorkSets root from the workarea (with fallback), then resolves and locks the WorkSet CFG file and name.

```cfg
_DYNAMIC_CONFIGS > WorkSpacePWSetup_Predefined_XXXX_CE.cfg 24.0.0.0

# 1 - WorkSets Root
%if defined (_DYNAMIC_WORKAREAROOT)
    _DYNAMIC_WORKAREA_CFG_PATH : _PWSetup/WorkSets/
    %if exists ($(_DYNAMIC_WORKAREAROOT)$(_DYNAMIC_WORKAREA_CFG_PATH))
        _DYNAMIC_WORKAREA_CFG_ROOT : $(_DYNAMIC_WORKAREAROOT)$(_DYNAMIC_WORKAREA_CFG_PATH)
    %else
        _DYNAMIC_WORKAREA_CFG_ROOT : $(_DYNAMIC_CEWORKSPACEROOT)WorkSets/
    %endif
%endif
_DYNAMIC_WORKAREA_CFG_ROOT : $(_DYNAMIC_CEWORKSPACEROOT)WorkSets/
_USTN_WORKSETSROOT : $(_DYNAMIC_WORKAREA_CFG_ROOT)
%lock _USTN_WORKSETSROOT

# 2 - WorkSet CFG
_DYNAMIC_WORKSET_DEFAULTNAME : DefaultWorkset
_DYNAMIC_WORKSET_NAME : $(_DYNAMIC_WORKAREAROOT_NAME)
%if exists ($(_DYNAMIC_WORKAREA_CFG_ROOT)$(_DYNAMIC_WORKSET_NAME).cfg)
    _USTN_WORKSETCFG = $(_DYNAMIC_WORKAREA_CFG_ROOT)$(_DYNAMIC_WORKSET_NAME).cfg
    _USTN_WORKSETNAME = $(_DYNAMIC_WORKSET_NAME)
%elif exists ($(_DYNAMIC_WORKAREA_CFG_ROOT)$(_DYNAMIC_WORKSET_DEFAULTNAME).cfg)
    _USTN_WORKSETCFG = $(_DYNAMIC_WORKAREA_CFG_ROOT)$(_DYNAMIC_WORKSET_DEFAULTNAME).cfg
    _USTN_WORKSETNAME = $(_DYNAMIC_WORKSET_DEFAULTNAME)
%else
    %error $(_DYNAMIC_MSG_NOT_FOUND) WORKSET CFG
%endif
%lock _USTN_WORKSETNAME
%lock _USTN_WORKSETCFG
```

---

### DMWF: _DYNAMIC_CONFIGS Tracking

**Prefixes:** `dynamic-configs`, `dconfigs`, `_DYNAMIC_CONFIGS`

Appends the current file name and minimum product version to `_DYNAMIC_CONFIGS`, which tracks the CFG load order for diagnostics.

```cfg
_DYNAMIC_CONFIGS > filename.cfg 24.0.0.0
```

---

### DMWF: @: Datasource Variable

**Prefixes:** `datasource`, `atcolon`, `@:`

Sets the `_DYNAMIC_DATASOURCE` to the `@:` macro (which expands to `pw:datasource/documents/`) and derives the datasource root name using `LASTDIRPIECE`.

```cfg
_DYNAMIC_DATASOURCE            = @:
_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME = $(LASTDIRPIECE(_DYNAMIC_DATASOURCE_BENTLEYROOT))
```

---

### DMWF: DMS_PROJECT Workarea Detection

**Prefixes:** `dms-project`, `workarea-detect`, `dmsproject`

Detects the ProjectWise workarea and its parent from `_DGNDIR` at the Predefined level using `DMS_PROJECT` and `DMS_PARENTPROJECT`.

```cfg
%if exists ($(DMS_PROJECT(_DGNDIR)))
    _DYNAMIC_WORKAREA              : $(DMS_PROJECT(_DGNDIR))
    _DYNAMIC_WORKAREA_NAME         : $(LASTDIRPIECE(_DYNAMIC_WORKAREA))
%endif

%if exists ($(DMS_PARENTPROJECT(_DGNDIR)))
    _DYNAMIC_PARENTWORKAREA        : $(DMS_PARENTPROJECT(_DGNDIR))
    _DYNAMIC_PARENTWORKAREA_NAME   : $(LASTDIRPIECE(_DYNAMIC_PARENTWORKAREA))
%endif
```

---

### DMWF: Connected Project Detection

**Prefixes:** `dms-connectedproject`, `connected-project`, `dmsconnected`

Detects the iTwin Connected Project and extracts its name and GUID from `_DGNDIR`.

```cfg
%if exists ($(DMS_CONNECTEDPROJECT(_DGNDIR)))
    _DYNAMIC_CONNECTEDPROJECT      : $(DMS_CONNECTEDPROJECT(_DGNDIR))
    _DYNAMIC_CONNECTEDPROJECTNAME  : $(LASTDIRPIECE(_DYNAMIC_CONNECTEDPROJECT))
    _USTN_CONNECT_PROJECTGUID      : $(DMS_CONNECTEDPROJECTGUID(_DGNDIR))
%endif
```

---

### DMWF: LASTDIRPIECE Function Call

**Prefixes:** `lastdirpiece`, `ldp`, `LASTDIRPIECE`

Inserts a call to the `LASTDIRPIECE()` built-in function, which extracts the last folder segment from a path variable.

```cfg
$(LASTDIRPIECE(_DYNAMIC_WORKAREA))
```

---

### DMWF: Validation Message Append

**Prefixes:** `validation-msg`, `dynamic-msg`, `_DYNAMIC_MSG_VALIDATION`

Appends a diagnostic entry to `_DYNAMIC_MSG_VALIDATION` for troubleshooting the DMWF load chain.

```cfg
_DYNAMIC_MSG_VALIDATION > VAR: $(dir(_USTN_CONFIGURATION))
```

---

### DMWF: PW_MWP_COMPARISON_IGNORE_LIST

**Prefixes:** `ignore-list`, `mwp-ignore`, `PW_MWP`

Suppresses dynamic, session-specific variables from the ProjectWise Managed Workspace comparison so they do not generate false drift warnings.

```cfg
PW_MWP_COMPARISON_IGNORE_LIST = PW_MWP_COMPARISON_IGNORE_LIST;_DGNDIR;_DGNFILE
PW_MWP_COMPARISON_IGNORE_LIST > FINDDIR_FOUNDDIR;FINDDIR_FOUNDNAME;FINDDIR_SEARCHED;_USTN_USERCFG;_DYNAMIC_CONFIGS
%lock PW_MWP_COMPARISON_IGNORE_LIST
```

---

### DMWF: Version Check (ORD)

**Prefixes:** `version-check`, `check-version`, `engineversion`

Validates that the user is running the expected product and major version, erroring out with a clear message if not. Application is selected from a dropdown.

```cfg
_DYNAMIC_CHECK_VERSION : 1
%if (_DYNAMIC_CHECK_VERSION)
    %if $(_ENGINENAME)=="OpenRoadsDesigner"
        _DYNAMIC_OpenRoadsDesigner_VERSION_GEN_MAJ : 24.00
        %if defined (_DYNAMIC_OpenRoadsDesigner_VERSION_GEN_MAJ)
            %if ($(_DYNAMIC_PRODUCT_VERSION_GEN_MAJ)!=$(_DYNAMIC_OpenRoadsDesigner_VERSION_GEN_MAJ))
                %error VERSION $(_DYNAMIC_PRODUCT_VERSION_GEN_MAJ) OF $(_ENGINENAME) IS NOT ALLOWED.  USE VERSION $(_DYNAMIC_OpenRoadsDesigner_VERSION_GEN_MAJ)
            %endif
        %endif
    %endif
%endif
```

*Application choices:* `MicroStation` `OpenRoadsDesigner` `OpenBridgeModeler` `OpenRailDesigner` `OpenBuildingsDesigner`

---

### DMWF: WorkspaceGroup Redirect

**Prefixes:** `workspace-group`, `workspacegroup`, `_DYNAMIC_WORKSPACEGROUPNAME`

Redirects the DMWF load chain to a client-specific workspace group, with an optional commented override for the workspace groups root path.

```cfg
_DYNAMIC_WORKSPACEGROUPNAME = ClientName
_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = Configuration2024
#_DYNAMIC_WORKSPACEGROUPSROOT : $(parentdevdir(_DYNAMIC_DATASOURCE_BENTLEYROOT))ClientWorkspaces/
```

---

### DMWF: PWSetup Include Chain

**Prefixes:** `pwsetup-include`, `include-pwsetup`, `pwsetupchain`

Standard guarded `%include` pattern for all PWSetup files. If the file is not found, appends a "NOT FOUND" message to `_DYNAMIC_MSG_VALIDATION` instead of silently failing.

```cfg
%if exists ($(_DYNAMIC_DATASOURCE_BENTLEYROOT)$(_DYNAMIC_PWSETUP_PATH)Common_Predefined_PWSetup.cfg)
    %include $(_DYNAMIC_DATASOURCE_BENTLEYROOT)$(_DYNAMIC_PWSETUP_PATH)Common_Predefined_PWSetup.cfg
%else
    _DYNAMIC_MSG_VALIDATION < NOT FOUND: $(_DYNAMIC_DATASOURCE_BENTLEYROOT)$(_DYNAMIC_PWSETUP_PATH)Common_Predefined_PWSetup.cfg
%endif
```

---

### DMWF: Workspace PWSetup Include

**Prefixes:** `workspace-include`, `include-workspace-pwsetup`

Standard pattern from `Common_Predefined.cfg` for including the workspace-level PWSetup predefined file, logging both found and not-found outcomes to `_DYNAMIC_MSG_VALIDATION`.

```cfg
%if exists ($(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)$(_DYNAMIC_PWSETUP_PATH)$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME))
    _DYNAMIC_MSG_VALIDATION > FOUND WORKSPACE PWSETUP: $(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)$(_DYNAMIC_PWSETUP_PATH)$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)
    %include $(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)$(_DYNAMIC_PWSETUP_PATH)$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)
%else
    _DYNAMIC_MSG_VALIDATION > NOT FOUND WORKSPACE PWSETUP: $(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)$(_DYNAMIC_PWSETUP_PATH)$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)
%endif
```

---

### DMWF: parentdevdir Path Navigation

**Prefixes:** `parentdevdir`, `parentdir`

Inserts a `parentdevdir()` built-in call, which strips the last directory segment from a path variable to navigate to a sibling folder.

```cfg
$(parentdevdir(_DYNAMIC_DATASOURCE_BENTLEYROOT))SiblingFolder/
```

---

## Quick Reference

| Prefix | Snippet |
|--------|---------|
| `hdr` | CFG File Header |
| `sep` | Section Separator Comment |
| `%level` | Set Level |
| `%include` | Include File |
| `includelevel` | Include with Level |
| `safeinclude` | If Exists Include |
| `safeincludelevel` | If Exists Include with Level |
| `wildinclude` | Wildcard Include |
| `ifdef` | If Defined |
| `ifndef` | If Not Defined |
| `ifdefelse` | If Defined with Else |
| `%if exists` | If Exists |
| `ifexistselse` | If Exists Else |
| `ifdefexists` | If Defined And Exists |
| `var` | Assign Variable |
| `append` | Append to Path Variable |
| `prepend` | Prepend to Path Variable |
| `default` | Assign If Not Defined |
| `%lock` | Lock Variable |
| `%undef` | Undefine Variable |
| `%define` | Define Macro |
| `ref` | Variable Reference (Deferred) |
| `refnow` | Variable Reference (Immediate) |
| `wsroot` | WorkSpace Root Path |
| `wstroot` | WorkSet Root Path |
| `wsstandards` | WorkSpace Standards Path |
| `orgpath` | Organization Path |
| `appstd` | App Standards Path |
| `seed` | Design Seed |
| `rfdir` | Reference File Directory |
| `pwvba` | ProjectWise VBA Search Directories |
| `drawingseeds` | Drawing Seeds DGNLib Reset |
| `reportsdirs` | Reports Directories Stack |
| `quickprint` | Quick Print Performance |
| `cells` | Cell Library |
| `dgnlib` | DGN Library |
| `templatelib` | Template Library |
| `plotfiles` | Plot Files Directory |
| `printorganizer` | Print Organizer |
| `linestyle` | Linestyle Resource |
| `mdlapps` | MDL Applications |
| `macros` | Macros Directory |
| `workspace-cfg` | WorkSpace CFG Template |
| `workset-cfg` | WorkSet CFG Template |
| `org-cfg` | Organization CFG Template |
| `wssetup` | WorkSpace Setup CFG Template |
| `ord-cfg` | ORD Civil Workspace CFG Template |
| `networkfallback` | Network Path Fallback |
| `lockvar` | Lock and Protect Variable |
| `protected` | Protected Section |
| `displayvars` | Display All Config Variables |
| `customconfig` | Custom Configuration Root |
| `rolecfg` | Role Configuration File |
| `capability` | Capability Flag |
| `encrypt` | Protection Encrypt |
| `designhistory` | Design History |
| `existscheck` | File Exists Check Comment Block |
| `multipath` | Multi-Path Search Setup |
| `csb-predefined` | DMWF: CSB Predefined Template |
| `workarea-pwsetup` | DMWF: WorkArea PWSetup Predefined |
| `workspace-pwsetup` | DMWF: Workspace PWSetup Predefined |
| `dynamic-configs` | DMWF: _DYNAMIC_CONFIGS Tracking |
| `datasource` | DMWF: @: Datasource Variable |
| `dms-project` | DMWF: DMS_PROJECT Workarea Detection |
| `dms-connectedproject` | DMWF: Connected Project Detection |
| `lastdirpiece` | DMWF: LASTDIRPIECE Function Call |
| `validation-msg` | DMWF: Validation Message Append |
| `ignore-list` | DMWF: PW_MWP_COMPARISON_IGNORE_LIST |
| `version-check` | DMWF: Version Check |
| `workspace-group` | DMWF: WorkspaceGroup Redirect |
| `pwsetup-include` | DMWF: PWSetup Include Chain |
| `workspace-include` | DMWF: Workspace PWSetup Include |
| `parentdevdir` | DMWF: parentdevdir Path Navigation |
