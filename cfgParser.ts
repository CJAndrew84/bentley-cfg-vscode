{
  "CFG File Header": {
    "prefix": ["hdr", "header", "cfgheader"],
    "body": [
      "#----------------------------------------------------------------------",
      "# ${1:FileName}.cfg",
      "#",
      "# ${2:Description}",
      "#",
      "# Author  : ${3:Your Name}",
      "# Created : ${4:${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}}",
      "# Modified: ${4:${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}}",
      "#",
      "# Level   : ${5|WorkSpace,WorkSet,Organization,System,Application,Role,User|}",
      "#----------------------------------------------------------------------",
      "$0"
    ],
    "description": "Standard CFG file header block"
  },

  "Section Separator Comment": {
    "prefix": ["sep", "section", "divider"],
    "body": [
      "#----------------------------------------------------------------------",
      "# ${1:Section Name}",
      "#----------------------------------------------------------------------",
      "$0"
    ],
    "description": "Section separator comment block"
  },

  "Set Level": {
    "prefix": ["%level", "level"],
    "body": ["%level ${1|0,1,2,3,4,5,6,WorkSpace,WorkSet,Organization,System,Application,Role,User|}"],
    "description": "Set configuration processing level"
  },

  "Include File": {
    "prefix": ["%include", "include"],
    "body": ["%include ${1:$(_USTN_WORKSPACEROOT)${2:filename.cfg}}"],
    "description": "%include directive"
  },

  "Include with Level": {
    "prefix": ["includelevel", "includelvl"],
    "body": ["%include ${1:$(_USTN_ORGANIZATION)${2:Standards.cfg}} level ${3|WorkSpace,WorkSet,Organization,System,Application,Role,User|}"],
    "description": "%include directive with level specification"
  },

  "If Exists Include": {
    "prefix": ["ifexists", "existsinclude", "safeinclude"],
    "body": [
      "%if exists (${1:$(_USTN_WORKSPACEROOT)${2:filename.cfg}})",
      "%  include ${1}",
      "%endif",
      "$0"
    ],
    "description": "Safely include a file if it exists"
  },

  "If Exists Include with Level": {
    "prefix": ["ifexistsinclude", "safeincludelevel"],
    "body": [
      "%if exists (${1:$(_USTN_WORKSPACEROOT)${2:filename.cfg}})",
      "%  include ${1} level ${3|WorkSpace,WorkSet,Organization,System,Application,Role,User|}",
      "%endif",
      "$0"
    ],
    "description": "Safely include a file with level if it exists"
  },

  "Wildcard Include": {
    "prefix": ["wildinclude", "includeall"],
    "body": [
      "%if exists (${1:$(_USTN_WORKSPACEROOT)}*.cfg)",
      "%  include ${1}*.cfg level ${2|WorkSpace,WorkSet,Organization,System,Application,Role,User|}",
      "%endif",
      "$0"
    ],
    "description": "Include all CFG files in a directory"
  },

  "If Defined": {
    "prefix": ["%ifdef", "ifdefined", "ifdef"],
    "body": [
      "%ifdef ${1:VARIABLE_NAME}",
      "  $2",
      "%endif",
      "$0"
    ],
    "description": "%ifdef conditional block"
  },

  "If Not Defined": {
    "prefix": ["%ifndef", "ifnotdefined", "ifndef"],
    "body": [
      "%ifndef ${1:VARIABLE_NAME}",
      "  $2",
      "%endif",
      "$0"
    ],
    "description": "%ifndef conditional block"
  },

  "If Defined with Else": {
    "prefix": ["ifdefelse", "ifdefinedelse"],
    "body": [
      "%ifdef ${1:VARIABLE_NAME}",
      "  $2",
      "%else",
      "  $3",
      "%endif",
      "$0"
    ],
    "description": "%ifdef / %else / %endif block"
  },

  "If Exists": {
    "prefix": ["%if exists", "ifexists"],
    "body": [
      "%if exists (${1:path/to/file})",
      "  $2",
      "%endif",
      "$0"
    ],
    "description": "%if exists conditional block"
  },

  "If Exists Else": {
    "prefix": ["ifexistselse"],
    "body": [
      "%if exists (${1:path/to/file})",
      "  $2",
      "%else",
      "  $3",
      "%endif",
      "$0"
    ],
    "description": "%if exists / %else / %endif block"
  },

  "Network Path Fallback": {
    "prefix": ["networkfallback", "netfallback", "drivefallback"],
    "body": [
      "%if exists (${1:W:/Bentley/CONNECTEdition})",
      "  ${2:_USTN_CUSTOM_CONFIGURATION} = ${1}/${3:Configuration}/",
      "%else",
      "  ${2} = ${4:C:/Bentley/CONNECTEdition}/${3}/",
      "%endif",
      "$0"
    ],
    "description": "Network drive with local fallback pattern"
  },

  "If Defined And Exists": {
    "prefix": ["ifdefinedexists", "ifdefexists"],
    "body": [
      "%if defined (${1:VARIABLE_NAME}) && exists ($(${1})${2:filename})",
      "  $3",
      "%endif",
      "$0"
    ],
    "description": "%if defined() && exists() combined check"
  },

  "Assign Variable": {
    "prefix": ["var", "assign", "set"],
    "body": ["${1:VARIABLE_NAME} = ${2:value}"],
    "description": "Simple variable assignment"
  },

  "Append to Path Variable": {
    "prefix": ["append", "appendpath", "addpath"],
    "body": ["${1:MS_RFDIR} > ${2:$(${3:_USTN_WORKSETROOT})${4:references/}}"],
    "description": "Append value to path variable (> operator)"
  },

  "Prepend to Path Variable": {
    "prefix": ["prepend", "prependpath"],
    "body": ["${1:MS_RFDIR} < ${2:$(${3:_USTN_WORKSETROOT})${4:references/}}"],
    "description": "Prepend value to path variable (< operator)"
  },

  "Assign If Not Defined": {
    "prefix": ["setifnot", "assignifnotdefined", "default"],
    "body": ["${1:VARIABLE_NAME} : ${2:default_value}"],
    "description": "Assign variable only if not already defined (: operator)"
  },

  "Lock Variable": {
    "prefix": ["%lock", "lock"],
    "body": ["%lock ${1:VARIABLE_NAME}"],
    "description": "Lock a variable to prevent override"
  },

  "Undefine Variable": {
    "prefix": ["%undef", "undefine", "clear"],
    "body": ["%undef ${1:VARIABLE_NAME}"],
    "description": "Undefine/clear a variable"
  },

  "Define Macro": {
    "prefix": ["%define", "define", "macro"],
    "body": ["%define ${1:MACRO_NAME}"],
    "description": "Define a macro flag"
  },

  "Variable Reference (Deferred)": {
    "prefix": ["ref", "varref", "$()"],
    "body": ["$(${1:VARIABLE_NAME})"],
    "description": "Deferred variable reference $() - evaluated at use time"
  },

  "Variable Reference (Immediate)": {
    "prefix": ["refnow", "varrefimmediate", "${}"],
    "body": ["${${1:VARIABLE_NAME}}"],
    "description": "Immediate variable reference ${} - evaluated at definition time"
  },

  "WorkSpace Root Path": {
    "prefix": ["wsroot", "workspaceroot"],
    "body": ["$(_USTN_WORKSPACEROOT)${1:subfolder/}"],
    "description": "Reference to workspace root directory"
  },

  "WorkSet Root Path": {
    "prefix": ["wstroot", "worksetroot"],
    "body": ["$(_USTN_WORKSETROOT)${1:subfolder/}"],
    "description": "Reference to workset root directory"
  },

  "WorkSpace Standards Path": {
    "prefix": ["wsstandards", "workspacestandards"],
    "body": ["$(_USTN_WORKSPACESTANDARDS)${1:subfolder/}"],
    "description": "Reference to workspace standards directory"
  },

  "Organization Path": {
    "prefix": ["orgpath", "organization"],
    "body": ["$(_USTN_ORGANIZATION)${1:subfolder/}"],
    "description": "Reference to organization directory"
  },

  "App Standards Path": {
    "prefix": ["appstd", "appstandards"],
    "body": ["$(APP_STANDARDS)${1:subfolder/}"],
    "description": "Reference to application standards directory"
  },

  "Design Seed": {
    "prefix": ["designseed", "seed", "msseed"],
    "body": ["MS_DESIGNSEED = $(${1:_USTN_WORKSETSTANDARDS})Seed/${2:seed3d.dgn}"],
    "description": "Set the design seed file"
  },

  "Reference File Directory": {
    "prefix": ["rfdir", "refsdir", "references"],
    "body": ["MS_RFDIR ${1|=,>,<|} $(${2:_USTN_WORKSETROOT})${3:References/}"],
    "description": "Set/append reference file search directory"
  },

  "Cell Library": {
    "prefix": ["celllist", "cells", "celllib"],
    "body": ["MS_CELLLIST ${1|=,>,<|} $(${2:_USTN_WORKSPACESTANDARDS})${3:Cell/}${4:cells.cel}"],
    "description": "Set/append cell library"
  },

  "DGN Library": {
    "prefix": ["dgnlib", "dgnliblist"],
    "body": ["MS_DGNLIB ${1|=,>,<|} $(${2:_USTN_WORKSPACESTANDARDS})${3:Dgnlib/}${4:standards.dgnlib}"],
    "description": "Set/append DGN library"
  },

  "Template Library": {
    "prefix": ["templatelib", "templates", "civiltemplate"],
    "body": ["CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/${1:$(_USTN_WORKSPACENAME).itl}"],
    "description": "Set the civil roadway template library path"
  },

  "Plot Files Directory": {
    "prefix": ["plotfiles", "plots", "output"],
    "body": ["MS_PLOTFILES = $(${1:_USTN_WORKSETROOT})${2:Output/Plots/}"],
    "description": "Set plot output directory"
  },

  "Print Organizer": {
    "prefix": ["printorganizer", "printorg"],
    "body": ["MS_PRINT_ORGANIZER = $(${1:_USTN_WORKSPACESTANDARDS})${2:PrintOrganizer/}"],
    "description": "Set Print Organizer search directory"
  },

  "Linestyle Resource": {
    "prefix": ["linestyle", "linestyles"],
    "body": ["MS_LINESTYLE ${1|=,>,<|} $(${2:_USTN_WORKSPACESTANDARDS})${3:Linestyle/}${4:linestyles.rsc}"],
    "description": "Set/append linestyle resource file"
  },

  "MDL Applications": {
    "prefix": ["mdlapps", "mdl"],
    "body": ["MS_MDLAPPS ${1|=,>,<|} $(${2:_USTN_WORKSPACEROOT})${3:Mdlapps/}"],
    "description": "Set/append MDL application search directory"
  },

  "Macros Directory": {
    "prefix": ["macros", "vbamacros"],
    "body": ["MS_MACROS ${1|=,>,<|} $(${2:_USTN_WORKSPACEROOT})${3:Macros/}"],
    "description": "Set/append macros search directory"
  },

  "WorkSpace CFG Template": {
    "prefix": ["workspace-cfg", "wscfg", "newworkspace"],
    "body": [
      "#----------------------------------------------------------------------",
      "# ${1:WorkSpaceName}.cfg - WorkSpace Configuration",
      "#",
      "# Defines the location of this WorkSpace's root, standards,",
      "# and WorkSets root directories.",
      "#----------------------------------------------------------------------",
      "",
      "%level WorkSpace",
      "",
      "#----------------------------------------------------------------------",
      "# Redirect WorkSpace to network location",
      "#----------------------------------------------------------------------",
      "# _USTN_WORKSPACEROOT = ${2:$(NETWORK_ROOT)$(_USTN_WORKSPACENAME)/}",
      "",
      "#----------------------------------------------------------------------",
      "# Redirect Standards",
      "#----------------------------------------------------------------------",
      "# _USTN_WORKSPACESTANDARDS = $(_USTN_WORKSPACEROOT)Standards/",
      "",
      "#----------------------------------------------------------------------",
      "# Redirect WorkSets Root",
      "#----------------------------------------------------------------------",
      "# _USTN_WORKSETSROOT = $(_USTN_WORKSPACEROOT)WorkSets/",
      "$0"
    ],
    "description": "WorkSpace CFG file template"
  },

  "WorkSet CFG Template": {
    "prefix": ["workset-cfg", "wstcfg", "newworkset"],
    "body": [
      "#----------------------------------------------------------------------",
      "# ${1:WorkSetName}.cfg - WorkSet Configuration",
      "#",
      "# Project-specific configuration for ${1:WorkSetName}",
      "# Created: ${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}",
      "#----------------------------------------------------------------------",
      "",
      "%level WorkSet",
      "",
      "#----------------------------------------------------------------------",
      "# Project-specific Design Seed",
      "#----------------------------------------------------------------------",
      "# MS_DESIGNSEED = $(_USTN_WORKSETSTANDARDS)Seed/${2:seed3d.dgn}",
      "",
      "#----------------------------------------------------------------------",
      "# Project-specific Reference Directories",
      "#----------------------------------------------------------------------",
      "MS_RFDIR > $(_USTN_WORKSETROOT)${3:References/}",
      "",
      "#----------------------------------------------------------------------",
      "# Project Output",
      "#----------------------------------------------------------------------",
      "MS_PLOTFILES = $(_USTN_WORKSETROOT)${4:Output/}",
      "$0"
    ],
    "description": "WorkSet CFG file template"
  },

  "Organization CFG Template": {
    "prefix": ["org-cfg", "orgcfg", "standards-cfg"],
    "body": [
      "#----------------------------------------------------------------------",
      "# Standards.cfg - Organization Configuration",
      "#",
      "# Company-wide configuration for ${1:Organization Name}",
      "# Applies to all WorkSpaces and WorkSets",
      "#----------------------------------------------------------------------",
      "",
      "%level Organization",
      "",
      "#----------------------------------------------------------------------",
      "# Design Seeds",
      "#----------------------------------------------------------------------",
      "MS_DESIGNSEED = $(_USTN_ORGANIZATION)Seed/${2:seed3d.dgn}",
      "",
      "#----------------------------------------------------------------------",
      "# Cell Libraries",
      "#----------------------------------------------------------------------",
      "MS_CELLLIST > $(_USTN_ORGANIZATION)Cell/",
      "",
      "#----------------------------------------------------------------------",
      "# DGN Libraries",
      "#----------------------------------------------------------------------",
      "MS_DGNLIB > $(_USTN_ORGANIZATION)Dgnlib/",
      "",
      "#----------------------------------------------------------------------",
      "# Line Styles",
      "#----------------------------------------------------------------------",
      "MS_LINESTYLE > $(_USTN_ORGANIZATION)Linestyle/",
      "",
      "#----------------------------------------------------------------------",
      "# Reference File Search Paths",
      "#----------------------------------------------------------------------",
      "MS_RFDIR > $(_USTN_ORGANIZATION)References/",
      "$0"
    ],
    "description": "Organization Standards CFG file template"
  },

  "WorkSpace Setup CFG Template": {
    "prefix": ["workspacesetup", "wssetup"],
    "body": [
      "#----------------------------------------------------------------------",
      "# WorkSpaceSetup.cfg",
      "#",
      "# Configures the WorkSpace label and root directories",
      "# for ${1:Organization Name}",
      "#----------------------------------------------------------------------",
      "",
      "#----------------------------------------------------------------------",
      "# WorkSpace label for your organization",
      "#----------------------------------------------------------------------",
      "_USTN_WORKSPACELABEL : ${2:Client}",
      "_USTN_WORKSETLABEL   : ${3:Project}",
      "",
      "#----------------------------------------------------------------------",
      "# Redirect WorkSpaces root to network share",
      "#----------------------------------------------------------------------",
      "%if exists (${4:W:/Bentley/Configuration})",
      "  _USTN_WORKSPACESROOT = ${4}/WorkSpaces/",
      "  _USTN_ORGANIZATION   = ${4}/Organization/",
      "%else",
      "  _USTN_WORKSPACESROOT = ${5:C:/Bentley/Configuration}/WorkSpaces/",
      "  _USTN_ORGANIZATION   = ${5}/Organization/",
      "%endif",
      "$0"
    ],
    "description": "WorkSpaceSetup.cfg template"
  },

  "ORD Civil Workspace CFG Template": {
    "prefix": ["ord-cfg", "ordcfg", "civil-cfg"],
    "body": [
      "#----------------------------------------------------------------------",
      "# ${1:WorkSpaceName}.cfg - OpenRoads Designer WorkSpace Configuration",
      "#",
      "# Civil/Road design workspace for ${1}",
      "# Created: ${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}",
      "#----------------------------------------------------------------------",
      "",
      "%level WorkSpace",
      "",
      "#----------------------------------------------------------------------",
      "# Civil Template Library",
      "#----------------------------------------------------------------------",
      "CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME = ${2:$(_USTN_WORKSPACENAME).itl}",
      "",
      "%if defined (CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME) && exists ($(APP_STANDARDS)Template Library/$(CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME))",
      "  CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/$(CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME)",
      "%endif",
      "",
      "#----------------------------------------------------------------------",
      "# Civil Design Seed",
      "#----------------------------------------------------------------------",
      "CIVIL_WORKSPACE_DESIGNSEED = ${3:design_seed3d_road.dgn}",
      "",
      "%if defined (CIVIL_WORKSPACE_DESIGNSEED) && exists ($(APP_STANDARDS)Seed/$(CIVIL_WORKSPACE_DESIGNSEED))",
      "  MS_DESIGNSEED = $(APP_STANDARDS)Seed/$(CIVIL_WORKSPACE_DESIGNSEED)",
      "%endif",
      "",
      "#----------------------------------------------------------------------",
      "# Feature Definitions",
      "#----------------------------------------------------------------------",
      "# CIVIL_FEATUREDEF > $(APP_STANDARDS)Feature Definitions/${4:FeatureDefs.xml}",
      "$0"
    ],
    "description": "OpenRoads Designer WorkSpace CFG template"
  },

  "Lock and Protect Variable": {
    "prefix": ["lockvar", "protect"],
    "body": [
      "${1:VARIABLE_NAME} = ${2:value}",
      "%lock ${1}"
    ],
    "description": "Set and immediately lock a variable"
  },

  "Protected Section": {
    "prefix": ["protected", "locksection"],
    "body": [
      "#----------------------------------------------------------------------",
      "# Protected Settings - Do not override below this point",
      "#----------------------------------------------------------------------",
      "${1:VARIABLE_NAME} = ${2:value}",
      "%lock ${1}",
      "$0"
    ],
    "description": "Protected settings section with lock"
  },

  "Display All Config Variables": {
    "prefix": ["displayvars", "showvars", "debugvars"],
    "body": ["_USTN_DISPLAYALLCFGVARS = 1"],
    "description": "Enable display of all configuration variables for debugging"
  },

  "Custom Configuration Root": {
    "prefix": ["customconfig", "customroot"],
    "body": ["_USTN_CUSTOM_CONFIGURATION = ${1:W:/Bentley/CONNECTEdition}/Configuration/"],
    "description": "Set custom configuration root directory"
  },

  "Role Configuration File": {
    "prefix": ["rolecfg", "role"],
    "body": ["_USTN_ROLECFG = $(_USTN_WORKSPACEROOT)${1:Roles}/${2:$(_USTN_ROLENAME)}.cfg"],
    "description": "Define the role configuration file path"
  },

  "Capability Flag": {
    "prefix": ["capability", "cap"],
    "body": ["_USTN_CAPABILITY ${1|=,>|} ${2|-CAPABILITY_LEVELS_CREATE,-CAPABILITY_LEVELS_DELETE,-CAPABILITY_MODELS_CREATE,+CAPABILITY_LEVELS_CREATE|}"],
    "description": "Set or modify a capability flag"
  },

  "Protection Encrypt": {
    "prefix": ["encrypt", "protection"],
    "body": [
      "MS_PROTECTION_ENCRYPT = ${1|0,1|}",
      "%lock MS_PROTECTION_ENCRYPT"
    ],
    "description": "Set and lock the file protection/encryption flag"
  },

  "Design History": {
    "prefix": ["designhistory", "history"],
    "body": [
      "MS_DESIGN_HISTORY = create=${1|0,1|};delete=${2|0,1|};commit=${3|0,1|};browse=${4|0,1|}",
      "%lock MS_DESIGN_HISTORY"
    ],
    "description": "Configure and lock design history settings"
  },

  "File Exists Check Comment Block": {
    "prefix": ["existscheck", "checkfile"],
    "body": [
      "# Check for ${1:description} and include if available",
      "%if exists (${2:$(_USTN_WORKSPACEROOT)${3:filename.cfg}})",
      "%  include ${2}",
      "%endif",
      "$0"
    ],
    "description": "Commented file existence check and include"
  },

  "Multi-Path Search Setup": {
    "prefix": ["multipath", "searchpaths"],
    "body": [
      "# ${1:Primary} search paths",
      "${2:MS_RFDIR} = $(${3:_USTN_WORKSETROOT})${4:References/}",
      "${2} > $(${5:_USTN_WORKSPACESTANDARDS})${6:References/}",
      "${2} > $(_USTN_ORGANIZATION)${6}",
      "$0"
    ],
    "description": "Set up layered multi-path search configuration"
  },

  "DMWF: CSB Predefined Template": {
    "prefix": ["csb-predefined", "dmwf-predefined", "csbpredefined"],
    "body": [
      "# Create variable, then browse to specific ProjectWise Folder",
      "_DYNAMIC_DATASOURCE_BENTLEYROOT : @:${1:Resources\\\\Bentley\\\\}",
      "%include \\$(_DYNAMIC_DATASOURCE_BENTLEYROOT)Common_Predefined.cfg",
      "$0"
    ],
    "description": "DMWF CSB Predefined level boilerplate — sets datasource root and includes Common_Predefined.cfg"
  },

  "DMWF: WorkArea PWSetup Predefined (CE)": {
    "prefix": ["workarea-pwsetup", "dmwf-workarea", "workareasetup"],
    "body": [
      "_DYNAMIC_CONFIGS > ${1:WorkAreaPWSetup_Predefined_${2:XXXX}_CE.cfg} 24.0.0.0",
      "",
      "%if defined (_VERSION_8_11)",
      "    %error This WorkArea not configured for V8i.",
      "%elif defined (_VERSION_10_0)",
      "    _DYNAMIC_WORKSPACEGROUPNAME = ${3:ClientName}",
      "    _DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = ${4:Configuration2024}",
      "    _DYNAMIC_CEWORKSPACENAME = ${5:CEWorkspaceName}",
      "%endif",
      "$0"
    ],
    "description": "DMWF WorkArea PWSetup Predefined template — sets workspace group and CE workspace name"
  },

  "DMWF: Workspace PWSetup Predefined (CE)": {
    "prefix": ["workspace-pwsetup", "dmwf-workspace", "workspacesetup"],
    "body": [
      "_DYNAMIC_CONFIGS > ${1:WorkSpacePWSetup_Predefined_${2:XXXX}_CE.cfg} 24.0.0.0",
      "",
      "# 1 - WorkSets Root",
      "%if defined (_DYNAMIC_WORKAREAROOT)",
      "    _DYNAMIC_WORKAREA_CFG_PATH : _PWSetup/WorkSets/",
      "    %if exists (\\$(_DYNAMIC_WORKAREAROOT)\\$(_DYNAMIC_WORKAREA_CFG_PATH))",
      "        _DYNAMIC_WORKAREA_CFG_ROOT : \\$(_DYNAMIC_WORKAREAROOT)\\$(_DYNAMIC_WORKAREA_CFG_PATH)",
      "    %else",
      "        _DYNAMIC_WORKAREA_CFG_ROOT : \\$(_DYNAMIC_CEWORKSPACEROOT)WorkSets/",
      "    %endif",
      "%endif",
      "_DYNAMIC_WORKAREA_CFG_ROOT : \\$(_DYNAMIC_CEWORKSPACEROOT)WorkSets/",
      "_USTN_WORKSETSROOT : \\$(_DYNAMIC_WORKAREA_CFG_ROOT)",
      "%lock _USTN_WORKSETSROOT",
      "",
      "# 2 - WorkSet CFG",
      "_DYNAMIC_WORKSET_DEFAULTNAME : ${3:DefaultWorkset}",
      "_DYNAMIC_WORKSET_NAME : \\$(_DYNAMIC_WORKAREAROOT_NAME)",
      "%if exists (\\$(_DYNAMIC_WORKAREA_CFG_ROOT)\\$(_DYNAMIC_WORKSET_NAME).cfg)",
      "    _USTN_WORKSETCFG = \\$(_DYNAMIC_WORKAREA_CFG_ROOT)\\$(_DYNAMIC_WORKSET_NAME).cfg",
      "    _USTN_WORKSETNAME = \\$(_DYNAMIC_WORKSET_NAME)",
      "%elif exists (\\$(_DYNAMIC_WORKAREA_CFG_ROOT)\\$(_DYNAMIC_WORKSET_DEFAULTNAME).cfg)",
      "    _USTN_WORKSETCFG = \\$(_DYNAMIC_WORKAREA_CFG_ROOT)\\$(_DYNAMIC_WORKSET_DEFAULTNAME).cfg",
      "    _USTN_WORKSETNAME = \\$(_DYNAMIC_WORKSET_DEFAULTNAME)",
      "%else",
      "    %error \\$(_DYNAMIC_MSG_NOT_FOUND) WORKSET CFG",
      "%endif",
      "%lock _USTN_WORKSETNAME",
      "%lock _USTN_WORKSETCFG",
      "$0"
    ],
    "description": "DMWF Workspace PWSetup Predefined template — configures WorkSets root, CFG, and name"
  },

  "DMWF: _DYNAMIC_CONFIGS tracking": {
    "prefix": ["dynamic-configs", "dconfigs", "_DYNAMIC_CONFIGS"],
    "body": [
      "_DYNAMIC_CONFIGS > ${1:${TM_FILENAME}} ${2:24.0.0.0}"
    ],
    "description": "DMWF _DYNAMIC_CONFIGS append — tracks cfg loading order and versions"
  },

  "DMWF: @: datasource variable": {
    "prefix": ["datasource", "atcolon", "@:"],
    "body": [
      "_DYNAMIC_DATASOURCE            = @:",
      "_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME = \\$(LASTDIRPIECE(_DYNAMIC_DATASOURCE_BENTLEYROOT))",
      "$0"
    ],
    "description": "DMWF @: datasource macro — @: expands to pw:datasource/documents/"
  },

  "DMWF: DMS_PROJECT workarea detection": {
    "prefix": ["dms-project", "workarea-detect", "dmsproject"],
    "body": [
      "%if exists (\\$(DMS_PROJECT(_DGNDIR)))",
      "    _DYNAMIC_WORKAREA              : \\$(DMS_PROJECT(_DGNDIR))",
      "    _DYNAMIC_WORKAREA_NAME         : \\$(LASTDIRPIECE(_DYNAMIC_WORKAREA))",
      "%endif",
      "",
      "%if exists (\\$(DMS_PARENTPROJECT(_DGNDIR)))",
      "    _DYNAMIC_PARENTWORKAREA        : \\$(DMS_PARENTPROJECT(_DGNDIR))",
      "    _DYNAMIC_PARENTWORKAREA_NAME   : \\$(LASTDIRPIECE(_DYNAMIC_PARENTWORKAREA))",
      "%endif",
      "$0"
    ],
    "description": "DMWF DMS_PROJECT pattern — detects PW workarea from _DGNDIR at Predefined level"
  },

  "DMWF: Connected project detection": {
    "prefix": ["dms-connectedproject", "connected-project", "dmsconnected"],
    "body": [
      "%if exists (\\$(DMS_CONNECTEDPROJECT(_DGNDIR)))",
      "    _DYNAMIC_CONNECTEDPROJECT      : \\$(DMS_CONNECTEDPROJECT(_DGNDIR))",
      "    _DYNAMIC_CONNECTEDPROJECTNAME  : \\$(LASTDIRPIECE(_DYNAMIC_CONNECTEDPROJECT))",
      "    _USTN_CONNECT_PROJECTGUID      : \\$(DMS_CONNECTEDPROJECTGUID(_DGNDIR))",
      "%endif",
      "$0"
    ],
    "description": "DMWF DMS_CONNECTEDPROJECT pattern — detects iTwin Connected Project"
  },

  "DMWF: LASTDIRPIECE function call": {
    "prefix": ["lastdirpiece", "ldp", "LASTDIRPIECE"],
    "body": [
      "\\$(LASTDIRPIECE(${1:_DYNAMIC_WORKAREA}))"
    ],
    "description": "LASTDIRPIECE() built-in — extracts the last folder segment from a path variable"
  },

  "DMWF: Validation message append": {
    "prefix": ["validation-msg", "dynamic-msg", "_DYNAMIC_MSG_VALIDATION"],
    "body": [
      "_DYNAMIC_MSG_VALIDATION > ${1:VAR}: \\$(${2:dir}(${3:_USTN_CONFIGURATION}))"
    ],
    "description": "DMWF validation message — appends diagnostic info to _DYNAMIC_MSG_VALIDATION"
  },

  "DMWF: PW_MWP_COMPARISON_IGNORE_LIST": {
    "prefix": ["ignore-list", "mwp-ignore", "PW_MWP"],
    "body": [
      "PW_MWP_COMPARISON_IGNORE_LIST = PW_MWP_COMPARISON_IGNORE_LIST;_DGNDIR;_DGNFILE",
      "PW_MWP_COMPARISON_IGNORE_LIST > FINDDIR_FOUNDDIR;FINDDIR_FOUNDNAME;FINDDIR_SEARCHED;_USTN_USERCFG;_DYNAMIC_CONFIGS",
      "%lock PW_MWP_COMPARISON_IGNORE_LIST",
      "$0"
    ],
    "description": "DMWF PW_MWP_COMPARISON_IGNORE_LIST — suppresses dynamic variables from Managed Workspace comparison"
  },

  "DMWF: Version check (ORD)": {
    "prefix": ["version-check", "check-version", "engineversion"],
    "body": [
      "_DYNAMIC_CHECK_VERSION : 1",
      "%if (_DYNAMIC_CHECK_VERSION)",
      "    %if \\$(_ENGINENAME)==\"${1|MicroStation,OpenRoadsDesigner,OpenBridgeModeler,OpenRailDesigner,OpenBuildingsDesigner|}\"",
      "        _DYNAMIC_${1/[^A-Za-z]/_/g}_VERSION_GEN_MAJ : ${2:24.00}",
      "        %if defined (_DYNAMIC_${1/[^A-Za-z]/_/g}_VERSION_GEN_MAJ)",
      "            %if (\\$(_DYNAMIC_PRODUCT_VERSION_GEN_MAJ)!=\\$(_DYNAMIC_${1/[^A-Za-z]/_/g}_VERSION_GEN_MAJ))",
      "                %error VERSION \\$(_DYNAMIC_PRODUCT_VERSION_GEN_MAJ) OF \\$(_ENGINENAME) IS NOT ALLOWED.  USE VERSION \\$(_DYNAMIC_${1/[^A-Za-z]/_/g}_VERSION_GEN_MAJ)",
      "            %endif",
      "        %endif",
      "    %endif",
      "%endif",
      "$0"
    ],
    "description": "DMWF product version check — validates correct application version for this workspace"
  },

  "DMWF: WorkspaceGroup redirect": {
    "prefix": ["workspace-group", "workspacegroup", "_DYNAMIC_WORKSPACEGROUPNAME"],
    "body": [
      "_DYNAMIC_WORKSPACEGROUPNAME = ${1:ClientName}",
      "_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = ${2:Configuration2024}",
      "#_DYNAMIC_WORKSPACEGROUPSROOT : \\$(parentdevdir(_DYNAMIC_DATASOURCE_BENTLEYROOT))${3:ClientWorkspaces}/",
      "$0"
    ],
    "description": "DMWF WorkspaceGroup — redirects configuration to a client-specific workspace group"
  },

  "DMWF: PWSetup include chain": {
    "prefix": ["pwsetup-include", "include-pwsetup", "pwsetupchain"],
    "body": [
      "%if exists (\\$(_DYNAMIC_DATASOURCE_BENTLEYROOT)\\$(_DYNAMIC_PWSETUP_PATH)${1:Common_Predefined_PWSetup.cfg})",
      "    %include \\$(_DYNAMIC_DATASOURCE_BENTLEYROOT)\\$(_DYNAMIC_PWSETUP_PATH)${1}",
      "%else",
      "    _DYNAMIC_MSG_VALIDATION < NOT FOUND: \\$(_DYNAMIC_DATASOURCE_BENTLEYROOT)\\$(_DYNAMIC_PWSETUP_PATH)${1}",
      "%endif",
      "$0"
    ],
    "description": "DMWF PWSetup include with existence check — standard pattern for all PWSetup includes"
  },

  "DMWF: Workspace PWSetup include": {
    "prefix": ["workspace-include", "include-workspace-pwsetup"],
    "body": [
      "%if exists (\\$(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)\\$(_DYNAMIC_PWSETUP_PATH)\\$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME))",
      "    _DYNAMIC_MSG_VALIDATION > FOUND WORKSPACE PWSETUP: \\$(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)\\$(_DYNAMIC_PWSETUP_PATH)\\$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)",
      "    %include \\$(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)\\$(_DYNAMIC_PWSETUP_PATH)\\$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)",
      "%else",
      "    _DYNAMIC_MSG_VALIDATION > NOT FOUND WORKSPACE PWSETUP: \\$(_DYNAMIC_CEWORKSPACEROOT_PWSETUP)\\$(_DYNAMIC_PWSETUP_PATH)\\$(_DYNAMIC_WORKSPACEPWSETUP_PREDEFINED_NAME)",
      "%endif",
      "$0"
    ],
    "description": "DMWF workspace PWSetup include — standard pattern from Common_Predefined.cfg"
  },

  "DMWF: parentdevdir path navigation": {
    "prefix": ["parentdevdir", "parentdir"],
    "body": [
      "\\$(parentdevdir(${1:_DYNAMIC_DATASOURCE_BENTLEYROOT}))${2:SiblingFolder}/"
    ],
    "description": "parentdevdir() built-in — strips the last directory segment to navigate to a sibling folder"
  }
}
