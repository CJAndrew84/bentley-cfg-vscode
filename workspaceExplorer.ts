import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Variable knowledge base
// ─────────────────────────────────────────────────────────────────────────────

interface CfgVariable {
  name: string;
  documentation: string;
  category: 'ustn' | 'ms' | 'civil' | 'user';
  valueHint?: string;
  example?: string;
}

const CFG_VARIABLES: CfgVariable[] = [
  // _USTN system variables
  { name: '_USTN_WORKSPACEROOT', category: 'ustn', documentation: 'Root directory for the current WorkSpace. All WorkSpace-level data is relative to this path.', example: '_USTN_WORKSPACEROOT = W:/Bentley/WorkSpaces/MyClient/' },
  { name: '_USTN_WORKSPACESTANDARDS', category: 'ustn', documentation: 'Directory containing WorkSpace-level standards (cells, dgnlibs, seeds, etc.).', example: '_USTN_WORKSPACESTANDARDS = $(_USTN_WORKSPACEROOT)Standards/' },
  { name: '_USTN_WORKSETSROOT', category: 'ustn', documentation: 'Root directory containing all WorkSet folders for this WorkSpace.', example: '_USTN_WORKSETSROOT = $(_USTN_WORKSPACEROOT)WorkSets/' },
  { name: '_USTN_WORKSPACENAME', category: 'ustn', documentation: 'The name of the currently active WorkSpace (set by MicroStation, not in CFG files).', valueHint: 'Read-only - set by MicroStation' },
  { name: '_USTN_WORKSPACECFG', category: 'ustn', documentation: 'Path to the currently active WorkSpace CFG file.', valueHint: 'Read-only - computed by msconfig.cfg' },
  { name: '_USTN_WORKSETROOT', category: 'ustn', documentation: 'Root directory for the current WorkSet (project).', example: '# Redirect: _USTN_WORKSETROOT = P:/Projects/$(_USTN_WORKSETNAME)/' },
  { name: '_USTN_WORKSETSTANDARDS', category: 'ustn', documentation: 'Directory containing WorkSet-level standards.', example: '_USTN_WORKSETSTANDARDS = $(_USTN_WORKSETROOT)Standards/' },
  { name: '_USTN_WORKSETDATA', category: 'ustn', documentation: 'Directory containing WorkSet DGN, DWG, and other design data files.', example: '_USTN_WORKSETDATA = $(_USTN_WORKSETROOT)dgn/' },
  { name: '_USTN_WORKSETNAME', category: 'ustn', documentation: 'The name of the currently active WorkSet (set by MicroStation).', valueHint: 'Read-only - set by MicroStation' },
  { name: '_USTN_WORKSPACESROOT', category: 'ustn', documentation: 'Root directory containing all WorkSpace folders. Defined in WorkSpaceSetup.cfg.', example: '_USTN_WORKSPACESROOT = W:/Bentley/Configuration/WorkSpaces/' },
  { name: '_USTN_CONFIGURATION', category: 'ustn', documentation: 'Root of the Bentley configuration directory (contains WorkSpaces, Organization, etc.).', valueHint: 'Usually set in ConfigurationSetup.cfg' },
  { name: '_USTN_CUSTOM_CONFIGURATION', category: 'ustn', documentation: 'Path to a custom configuration directory that overrides the default Bentley configuration.', example: '_USTN_CUSTOM_CONFIGURATION = W:/Bentley/CONNECTEdition/Configuration/' },
  { name: '_USTN_ORGANIZATION', category: 'ustn', documentation: 'Root directory for organization-wide standards. Default: $(_USTN_CONFIGURATION)Organization/', example: '_USTN_ORGANIZATION = W:/Bentley/Configuration/Organization/' },
  { name: '_USTN_ROLECFG', category: 'ustn', documentation: 'Path to the role-level configuration file. When defined, this file is processed after WorkSpace/WorkSet files.', example: '_USTN_ROLECFG = $(_USTN_WORKSPACEROOT)Roles/$(_USTN_ROLENAME).cfg' },
  { name: '_USTN_ROLENAME', category: 'ustn', documentation: 'Name of the current user role.', valueHint: 'Set externally or in user config' },
  { name: '_USTN_WORKSPACELABEL', category: 'ustn', documentation: 'Display label used in the MicroStation UI instead of "WorkSpace". E.g., "Client" or "Department".', example: '_USTN_WORKSPACELABEL : Client' },
  { name: '_USTN_WORKSETLABEL', category: 'ustn', documentation: 'Display label used in the MicroStation UI instead of "WorkSet". E.g., "Project".', example: '_USTN_WORKSETLABEL : Project' },
  { name: '_USTN_DISPLAYALLCFGVARS', category: 'ustn', documentation: 'When set to 1, displays all configuration variables (including hidden _USTN_ vars) in the Config Variables dialog. Useful for debugging.', example: '_USTN_DISPLAYALLCFGVARS = 1', valueHint: '0 or 1' },
  { name: '_USTN_CAPABILITY', category: 'ustn', documentation: 'Controls user capability flags. Use + to enable, - to disable capabilities.', example: '_USTN_CAPABILITY > -CAPABILITY_LEVELS_CREATE' },
  { name: '_USTN_USERNAME', category: 'ustn', documentation: 'The current Windows username.', example: '_USTN_USERNAME = $(USERNAME)' },

  // MS_ variables
  { name: 'MS_DESIGNSEED', category: 'ms', documentation: 'Path to the default seed DGN file used when creating new design files. Must be a specific file path.', example: 'MS_DESIGNSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed3d.dgn' },
  { name: 'MS_RFDIR', category: 'ms', documentation: 'Search path(s) for reference files. Use > to append or < to prepend additional directories. Semicolon-separated.', example: 'MS_RFDIR > $(_USTN_WORKSETROOT)References/' },
  { name: 'MS_CELLLIST', category: 'ms', documentation: 'Search path(s) for cell libraries (.cel files). Use > to append directories.', example: 'MS_CELLLIST > $(_USTN_WORKSPACESTANDARDS)Cell/' },
  { name: 'MS_DGNLIB', category: 'ms', documentation: 'Search path(s) for DGN library files (.dgnlib). Used for shared levels, styles, etc.', example: 'MS_DGNLIB > $(_USTN_WORKSPACESTANDARDS)Dgnlib/' },
  { name: 'MS_DGNLIBLIST', category: 'ms', documentation: 'Specific list of DGN library files to load (as opposed to MS_DGNLIB which is a search directory).', example: 'MS_DGNLIBLIST > $(_USTN_WORKSPACESTANDARDS)Dgnlib/levels.dgnlib' },
  { name: 'MS_SYSTEMDGNLIBLIST', category: 'ms', documentation: 'System-level DGN library list (higher priority than MS_DGNLIBLIST).', valueHint: 'Path to .dgnlib file' },
  { name: 'MS_PLOTFILES', category: 'ms', documentation: 'Default output directory for plot/print files.', example: 'MS_PLOTFILES = $(_USTN_WORKSETROOT)Output/Plots/' },
  { name: 'MS_PLTCFG', category: 'ms', documentation: 'Search path for printer driver (.pltcfg) files.', example: 'MS_PLTCFG > $(_USTN_WORKSPACESTANDARDS)Plot/' },
  { name: 'MS_LINESTYLE', category: 'ms', documentation: 'Search path(s) for custom line style resource files.', example: 'MS_LINESTYLE > $(_USTN_WORKSPACESTANDARDS)Linestyle/' },
  { name: 'MS_MDLAPPS', category: 'ms', documentation: 'Search path(s) for MDL applications to load.', example: 'MS_MDLAPPS > $(_USTN_WORKSPACEROOT)Mdlapps/' },
  { name: 'MS_MACROS', category: 'ms', documentation: 'Search path(s) for VBA macro files.', example: 'MS_MACROS > $(_USTN_WORKSPACEROOT)Macros/' },
  { name: 'MS_PATTERN', category: 'ms', documentation: 'Search path for area pattern cell libraries.', example: 'MS_PATTERN > $(_USTN_WORKSPACESTANDARDS)Pattern/' },
  { name: 'MS_DEF', category: 'ms', documentation: 'Default directory for design files shown in File Open dialog.', example: 'MS_DEF = $(_USTN_WORKSETDATA)' },
  { name: 'MS_GUIDATA', category: 'ms', documentation: 'Search path for GUI customization data (toolboxes, tool settings, etc.).', example: 'MS_GUIDATA > $(_USTN_WORKSPACEROOT)Guidata/' },
  { name: 'MS_SYMBRSRC', category: 'ms', documentation: 'Symbolism resource files search path.', valueHint: 'Path to .rsc file' },
  { name: 'MS_DWGSEED', category: 'ms', documentation: 'Path to seed DWG file used when creating new DWG files.', example: 'MS_DWGSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed.dwg' },
  { name: 'MS_DWGDATA', category: 'ms', documentation: 'Configuration data for DWG file handling.', valueHint: 'Path to DWG data directory' },
  { name: 'MS_BACKUP', category: 'ms', documentation: 'Directory for automatic backup files.', example: 'MS_BACKUP = $(_USTN_WORKSETROOT)Backup/' },
  { name: 'MS_FILEHISTORY', category: 'ms', documentation: 'Controls file history feature (0=off, 1=on).', valueHint: '0 or 1' },
  { name: 'MS_PRINT', category: 'ms', documentation: 'Search path for print/plot configuration.', example: 'MS_PRINT > $(_USTN_WORKSPACESTANDARDS)Print/' },
  { name: 'MS_PRINT_ORGANIZER', category: 'ms', documentation: 'Search path for Print Organizer print set (.pset) files.', example: 'MS_PRINT_ORGANIZER > $(_USTN_WORKSPACESTANDARDS)PrintOrganizer/' },
  { name: 'MS_IPLOT', category: 'ms', documentation: 'iPlot configuration search path.', valueHint: 'Path to iPlot config directory' },
  { name: 'MS_RENDERDATA', category: 'ms', documentation: 'Search path for rendering materials and data.', example: 'MS_RENDERDATA > $(_USTN_WORKSPACESTANDARDS)Renderdata/' },
  { name: 'MS_TASKNAVIGATORCFG', category: 'ms', documentation: 'Path to task navigator configuration XML file.', example: 'MS_TASKNAVIGATORCFG = $(_USTN_WORKSPACESTANDARDS)Xml/TaskNav.xml' },
  { name: 'MS_PDFEXPORT', category: 'ms', documentation: 'Search path for PDF export configuration.', example: 'MS_PDFEXPORT > $(_USTN_WORKSPACESTANDARDS)PdfExport/' },
  { name: 'MS_PROTECTION_ENCRYPT', category: 'ms', documentation: 'Controls file encryption on save. 0=none, 1=encrypt. Use %lock to prevent override.', valueHint: '0 or 1', example: 'MS_PROTECTION_ENCRYPT = 0\n%lock MS_PROTECTION_ENCRYPT' },
  { name: 'MS_DESIGN_HISTORY', category: 'ms', documentation: 'Controls design history tracking. Semicolon-separated key=value pairs.', example: 'MS_DESIGN_HISTORY = create=0;delete=0;commit=0;browse=0' },
  { name: 'MS_EXPANDLEVELNAMES', category: 'ms', documentation: 'Controls how level names are expanded/displayed.', valueHint: '0 or 1' },
  { name: 'MS_KEYIN', category: 'ms', documentation: 'Search path for key-in definition files.', example: 'MS_KEYIN > $(_USTN_WORKSPACEROOT)Data/' },
  { name: 'MS_OUTPUT', category: 'ms', documentation: 'Default output directory for exports.', example: 'MS_OUTPUT = $(_USTN_WORKSETROOT)Output/' },
  { name: 'MS_MATERIAL', category: 'ms', documentation: 'Search path for rendering material (.mat) files.', example: 'MS_MATERIAL > $(_USTN_WORKSPACESTANDARDS)Material/' },
  { name: 'MS_SPLINES', category: 'ms', documentation: 'Configuration for spline/curve behavior.', valueHint: 'Path or setting value' },

  // Civil/ORD variables
  { name: 'CIVIL_ROADWAY_TEMPLATE_LIBRARY', category: 'civil', documentation: 'Full path to the road template library (.itl) file for OpenRoads Designer.', example: 'CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/$(_USTN_WORKSPACENAME).itl' },
  { name: 'CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME', category: 'civil', documentation: 'Filename of the workspace-level template library. Used to construct CIVIL_ROADWAY_TEMPLATE_LIBRARY.', example: 'CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME = MyClient.itl' },
  { name: 'CIVIL_WORKSPACE_DESIGNSEED', category: 'civil', documentation: 'Filename of the civil design seed to use (resolved against APP_STANDARDS/Seed/).', example: 'CIVIL_WORKSPACE_DESIGNSEED = design_seed3d_road.dgn' },
  { name: 'APP_STANDARDS', category: 'civil', documentation: 'Path to the active application standards directory (OpenRoads Designer specific).', valueHint: 'Read-only - set by ORD application' },
  { name: 'CIVIL_FEATUREDEF', category: 'civil', documentation: 'Search path for civil feature definition XML files.', example: 'CIVIL_FEATUREDEF > $(APP_STANDARDS)Feature Definitions/' },
  { name: 'CIVIL_CORRIDORDEF', category: 'civil', documentation: 'Search path for civil corridor definition files.', valueHint: 'Path to corridor definitions' },
  { name: 'CIVIL_ORGANIZATION', category: 'civil', documentation: 'Organization-level civil standards path.', example: 'CIVIL_ORGANIZATION = $(_USTN_ORGANIZATION)Civil/' },
  { name: 'ORD_CONNECT_WORKSPACE_DIR', category: 'civil', documentation: 'Root directory of the ORD CONNECT Workspace. Often set as a Windows environment variable.', example: 'ORD_CONNECT_WORKSPACE_DIR = C:/MICROSTATION_CONNECT_WORKSPACE/' },

  // DMWF framework variables (_DYNAMIC_*)
  { name: '_DYNAMIC_DATASOURCE', category: 'user', documentation: 'Expands to the ProjectWise datasource root (`@:`). Set in the Predefined-level CSB. All other _DYNAMIC_ root paths are derived from this.', example: '_DYNAMIC_DATASOURCE = @:' },
  { name: '_DYNAMIC_DATASOURCE_BENTLEYROOT', category: 'user', documentation: 'Full PW path to the DMWF Bentley root folder (contains Configuration/, Common_Predefined.cfg, etc.). This is the master anchor for all DMWF paths.', example: '_DYNAMIC_DATASOURCE_BENTLEYROOT : @:Resources\\Bentley\\' },
  { name: '_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME', category: 'user', documentation: 'Last directory segment of _DYNAMIC_DATASOURCE_BENTLEYROOT, extracted via LASTDIRPIECE(). Used for display/logging.', example: '_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME = $(LASTDIRPIECE(_DYNAMIC_DATASOURCE_BENTLEYROOT))' },
  { name: '_DYNAMIC_CEWORKSPACENAME', category: 'user', documentation: 'Name of the CONNECT Edition Workspace (matches the folder under Configuration/WorkSpaces/ and the corresponding .cfg file). Set in the WorkArea PWSetup cfg.', example: '_DYNAMIC_CEWORKSPACENAME = CEWorkspaceExampleAdv' },
  { name: '_DYNAMIC_CEWORKSPACEROOT', category: 'user', documentation: 'Full path to the CE Workspace root folder (Configuration/WorkSpaces/[WorkspaceName]/).', example: '_DYNAMIC_CEWORKSPACEROOT = $(_DYNAMIC_CEWORKSPACESROOT)$(_DYNAMIC_CEWORKSPACENAME)/' },
  { name: '_DYNAMIC_CEWORKSPACESROOT', category: 'user', documentation: 'Path to the WorkSpaces directory within the Configuration root.', example: '_DYNAMIC_CEWORKSPACESROOT = $(_USTN_CONFIGURATION)WorkSpaces/' },
  { name: '_DYNAMIC_CONFIGURATIONROOT', category: 'user', documentation: 'Path to the configuration root directory (the folder containing WorkSpaces/, Organization/, etc.). Mapped to _USTN_CONFIGURATION.', example: '_DYNAMIC_CONFIGURATIONROOT = $(_DYNAMIC_DATASOURCE_BENTLEYROOT)Configuration/' },
  { name: '_DYNAMIC_CONFIGURATIONNAME', category: 'user', documentation: 'Name of the Configuration folder (default: "Configuration"). Can be overridden for different versions (e.g., "Configuration2024").', example: '_DYNAMIC_CONFIGURATIONNAME : Configuration' },
  { name: '_DYNAMIC_WORKAREA', category: 'user', documentation: 'Full PW path to the current work area (project folder), populated from DMS_PROJECT(_DGNDIR) at Predefined level. The primary anchor for WorkSet identification.', example: '%if exists ($(DMS_PROJECT(_DGNDIR)))\n    _DYNAMIC_WORKAREA : $(DMS_PROJECT(_DGNDIR))\n%endif' },
  { name: '_DYNAMIC_WORKAREA_NAME', category: 'user', documentation: 'Last directory segment of _DYNAMIC_WORKAREA — i.e., the ProjectWise workarea folder name.', example: '_DYNAMIC_WORKAREA_NAME : $(LASTDIRPIECE(_DYNAMIC_WORKAREA))' },
  { name: '_DYNAMIC_WORKAREAROOT', category: 'user', documentation: 'Resolved root path of the work area, used as the base for WorkSet configuration lookups.', example: '_DYNAMIC_WORKAREAROOT : $(_DYNAMIC_WORKAREA)' },
  { name: '_DYNAMIC_WORKAREAROOT_NAME', category: 'user', documentation: 'Name portion of _DYNAMIC_WORKAREAROOT, used to look up WorkSet CFG and DGNWS files by name.', example: '_DYNAMIC_WORKAREAROOT_NAME : $(lastdirpiece(_DYNAMIC_WORKAREAROOT))' },
  { name: '_DYNAMIC_WORKSET_DEFAULTNAME', category: 'user', documentation: 'Fallback WorkSet name when the work area name does not match any CFG file. Set in the Workspace PWSetup file.', example: '_DYNAMIC_WORKSET_DEFAULTNAME : ConnectExample' },
  { name: '_DYNAMIC_WORKSET_NAME', category: 'user', documentation: 'Resolved name for the current WorkSet — typically $(_DYNAMIC_WORKAREAROOT_NAME) or the default name.', example: '_DYNAMIC_WORKSET_NAME : $(_DYNAMIC_WORKAREAROOT_NAME)' },
  { name: '_DYNAMIC_PWSETUP_PATH', category: 'user', documentation: 'Relative sub-path within each root folder where PWSetup control files are stored. Default: `_PWSetup/`', example: '_DYNAMIC_PWSETUP_PATH : _PWSetup/' },
  { name: '_DYNAMIC_WORKAREA_PWSETUP_PATH', category: 'user', documentation: 'Path within the work area folder where WorkArea PWSetup cfg files are located. Default: `_PWSetup/`.', example: '_DYNAMIC_WORKAREA_PWSETUP_PATH : _PWSetup/' },
  { name: '_DYNAMIC_WORKAREA_CFG_PATH', category: 'user', documentation: 'Sub-path within the work area for WorkSet CFG files. Default: `_PWSetup/WorkSets/`', example: '_DYNAMIC_WORKAREA_CFG_PATH : _PWSetup/WorkSets/' },
  { name: '_DYNAMIC_WORKAREA_CFG_ROOT', category: 'user', documentation: 'Full resolved path to the directory containing WorkSet CFG files. Used to locate the WorkSet .cfg and .dgnws files.', example: '_DYNAMIC_WORKAREA_CFG_ROOT : $(_DYNAMIC_WORKAREAROOT)$(_DYNAMIC_WORKAREA_CFG_PATH)' },
  { name: '_DYNAMIC_WORKAREA_WORKSET_PATH', category: 'user', documentation: 'Sub-path from the work area root to the WorkSet data root (often empty or a sub-folder like `CADFILES/`).', example: '_DYNAMIC_WORKAREA_WORKSET_PATH : $(_DYNAMIC_WORKAREA_SUBPATH)' },
  { name: '_DYNAMIC_WORKAREA_SUBPATH', category: 'user', documentation: 'Additional sub-path within the work area to reach WorkSet data. Default is empty (work area IS the workset root). Set to `CADFILES/` etc. for deeper structures.', example: '_DYNAMIC_WORKAREA_SUBPATH : CADFILES/' },
  { name: '_DYNAMIC_CONFIGS', category: 'user', documentation: 'Running log of all loaded CFG files and their versions. Append with `>` from each file. Used for diagnostics and version tracking.', example: '_DYNAMIC_CONFIGS > Common_Predefined.cfg 24.0.0.0' },
  { name: '_DYNAMIC_MSG_VALIDATION', category: 'user', documentation: 'Accumulates diagnostic messages during configuration load. Append with `>`. If _DYNAMIC_DEBUG_COMMONPREDEFINED=1, displayed as an error at end of load.', example: '_DYNAMIC_MSG_VALIDATION > VAR: _USTN_CONFIGURATION=$(dir(_USTN_CONFIGURATION))' },
  { name: '_DYNAMIC_MSG_NOT_FOUND', category: 'user', documentation: 'Standard "NOT FOUND:" prefix string used in DMWF error and validation messages.', example: '_DYNAMIC_MSG_NOT_FOUND : NOT FOUND:' },
  { name: '_DYNAMIC_WORKSPACEGROUPNAME', category: 'user', documentation: 'Name of the Workspace Group (client). When defined, routes configuration lookups through the ClientWorkspaces hierarchy.', example: '_DYNAMIC_WORKSPACEGROUPNAME = ClientName' },
  { name: '_DYNAMIC_WORKSPACEGROUPROOT', category: 'user', documentation: 'Full path to the specific workspace group folder within _DYNAMIC_WORKSPACEGROUPSROOT.', example: '_DYNAMIC_WORKSPACEGROUPROOT = $(_DYNAMIC_WORKSPACEGROUPSROOT)$(_DYNAMIC_WORKSPACEGROUPNAME)/' },
  { name: '_DYNAMIC_WORKSPACEGROUPSROOT', category: 'user', documentation: 'Root path containing all workspace group (client) folders. Can point to a PW folder using @: or a local path.', example: '_DYNAMIC_WORKSPACEGROUPSROOT = @:ClientWorkspaces/' },
  { name: '_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME', category: 'user', documentation: 'Name of the Configuration folder within a Workspace Group root. Allows different clients to use different configuration versions.', example: '_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = Configuration2024' },
  { name: '_DYNAMIC_CONNECTEDPROJECT', category: 'user', documentation: 'Full PW path to the iTwin Connected Project associated with the current document\'s folder, populated from DMS_CONNECTEDPROJECT(_DGNDIR).', example: '_DYNAMIC_CONNECTEDPROJECT : $(DMS_CONNECTEDPROJECT(_DGNDIR))' },
  { name: '_DYNAMIC_CONNECTEDPROJECTNAME', category: 'user', documentation: 'Name of the Connected Project (last directory segment of _DYNAMIC_CONNECTEDPROJECT).', example: '_DYNAMIC_CONNECTEDPROJECTNAME : $(LASTDIRPIECE(_DYNAMIC_CONNECTEDPROJECT))' },
  { name: '_DYNAMIC_CHECK_VERSION', category: 'user', documentation: 'When set to 1, enables the product version check in the Workspace PWSetup file. Prevents loading with wrong application version.', example: '_DYNAMIC_CHECK_VERSION : 1', valueHint: '0 or 1' },
  { name: '_DYNAMIC_IS_RADS_JOB', category: 'user', documentation: 'Set to 1 when the configuration is loaded by a RADS (Rendering and Document Services) rendition job. Disables interactive UI components.', example: '_DYNAMIC_IS_RADS_JOB : 0', valueHint: '0 or 1' },
  { name: '_DYNAMIC_PRODUCT_VERSION_GEN_MAJ', category: 'user', documentation: 'The generation.major version string of the currently running application (e.g., "24.00"). Used in version check logic.', valueHint: 'Read-only — set by Common_Predefined_ProductVersion.cfg' },
  { name: 'PW_MWP_COMPARISON_IGNORE_LIST', category: 'user', documentation: 'Semicolon-separated list of variable names excluded from Managed Workspace Profile comparison. Dynamic variables that change per session should be added here.', example: 'PW_MWP_COMPARISON_IGNORE_LIST = PW_MWP_COMPARISON_IGNORE_LIST;_DGNDIR;_DGNFILE\n%lock PW_MWP_COMPARISON_IGNORE_LIST' },

  // System/platform read-only variables
  { name: '_DGNDIR', category: 'user', documentation: 'Full PW path to the directory containing the currently open DGN/DWG file. Key anchor for dynamic workspace resolution — used with DMS_PROJECT() etc.', valueHint: 'Read-only — set by ProjectWise Explorer' },
  { name: '_DGNFILE', category: 'user', documentation: 'Filename (without path) of the currently open DGN/DWG file.', valueHint: 'Read-only — set by ProjectWise Explorer' },
  { name: '_ENGINENAME', category: 'user', documentation: 'Name of the running application engine. Matches the product name: "MicroStation", "OpenRoadsDesigner", "OpenBridgeModeler", "OpenRailDesigner", etc. Use in %if conditions for product-specific config.', valueHint: 'Read-only — e.g., "OpenRoadsDesigner"', example: '%if $(_ENGINENAME)=="OpenRoadsDesigner"\n    # ORD-specific config\n%endif' },
  { name: '_VERSION_10_0', category: 'user', documentation: 'Defined when the application is a CONNECT Edition (CE) product. Use in %if %ifdef to distinguish CE from V8i.', valueHint: 'Read-only — defined by application' },
  { name: '_VERSION_8_11', category: 'user', documentation: 'Defined when the application is a V8i product (MicroStation V8i, ORD CONNECT prior to CE). DMWF 24.0 no longer supports V8; this is kept for deprecation checks.', valueHint: 'Read-only — defined by application' },
  { name: '_PLATFORMNAME', category: 'user', documentation: 'Name of the OS platform (e.g., "WINNT").', valueHint: 'Read-only — e.g., "WINNT"' },
  { name: '_ROOTDIR', category: 'user', documentation: 'Root directory of the Bentley application installation (the folder containing the MicroStation.exe or equivalent).', valueHint: 'Read-only — set by application' },
  { name: '_WINNT', category: 'user', documentation: 'Defined when running on Windows NT/10/11. Use in %ifdef for OS-conditional configuration.', valueHint: 'Read-only — defined on Windows' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Built-in function hover docs (Keywords4 in UDL)
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_FUNCTIONS: Record<string, string> = {
  'lastdirpiece': '**LASTDIRPIECE(var)** — Returns the last directory segment of a path variable.\n\nExample: if `_DYNAMIC_WORKAREA = @:Projects/Bridge/`, then `$(LASTDIRPIECE(_DYNAMIC_WORKAREA))` returns `Bridge`.\n\nCase-insensitive in the CFG engine.',
  'parentdevdir': '**parentdevdir(var)** — Strips the final directory segment and the device/drive prefix from a path, returning the parent directory portion.\n\nUsed to navigate to sibling folders: `$(parentdevdir(_DYNAMIC_DATASOURCE_BENTLEYROOT))ClientWorkspaces/`',
  'parentdir': '**parentdir(var)** — Returns the parent directory of the path (one level up), retaining the drive/device.',
  'devdir': '**devdir(var)** — Returns the device (drive letter or UNC server) plus directory of a path variable.',
  'dev': '**dev(var)** — Returns only the device/drive portion of a path variable (e.g., `C:`).',
  'dir': '**dir(var)** — Returns the directory portion of a path variable, including trailing separator.',
  'basename': '**basename(var)** — Returns the base filename without extension.',
  'filename': '**filename(var)** — Returns the full filename (base + extension) from a path variable.',
  'ext': '**ext(var)** — Returns the file extension (including the dot) from a path variable.',
  'noext': '**noext(var)** — Returns the full path with the file extension removed.',
  'first': '**first(var)** — Returns the first entry from a semicolon-separated search path variable.',
  'concat': '**concat(var1,var2)** — Concatenates two variable values.',
  'build': '**build(var)** — Returns the build number portion of a version string variable.',
  'registryread': '**registryread(key,value)** — Reads a value from the Windows registry. Used in DMWF version detection (e.g., reading PW Explorer version).\n\nExample: `$(registryread(HKLM\\\\SOFTWARE\\\\...,DisplayVersion))`',
  'dms_project': '**DMS_PROJECT(var)** — Returns the full ProjectWise datasource path to the PW workarea (project folder) that contains the path in *var*. Always used with `_DGNDIR`.\n\nExample: `$(DMS_PROJECT(_DGNDIR))` returns the PW workarea containing the open document.',
  'dms_parentproject': '**DMS_PARENTPROJECT(var)** — Returns the parent workarea of the folder in *var*. Used for nested workarea structures.\n\nExample: `$(DMS_PARENTPROJECT(_DGNDIR))`',
  'dms_connectedproject': '**DMS_CONNECTEDPROJECT(var)** — Returns the PW path to the iTwin Connected Project linked to the folder in *var*.\n\nExample: `$(DMS_CONNECTEDPROJECT(_DGNDIR))`',
  'dms_connectedprojectguid': '**DMS_CONNECTEDPROJECTGUID(var)** — Returns the GUID of the iTwin Connected Project linked to the folder in *var*. Mapped to `_USTN_CONNECT_PROJECTGUID`.',
};

const DIRECTIVES = [
  { name: '%include', doc: 'Include one or more configuration files. Can include wildcards. Optionally specify a processing level.' },
  { name: '%if', doc: 'Begin a conditional block. Supports exists(), defined(), and logical operators && and ||.' },
  { name: '%ifdef', doc: 'Begin a conditional block that executes if the specified variable is defined.' },
  { name: '%ifndef', doc: 'Begin a conditional block that executes if the specified variable is NOT defined.' },
  { name: '%else', doc: 'Alternative branch of a %if, %ifdef, or %ifndef block.' },
  { name: '%elseif', doc: 'Additional conditional branch (also written as %elif).' },
  { name: '%endif', doc: 'Closes a %if, %ifdef, or %ifndef block.' },
  { name: '%lock', doc: 'Locks a configuration variable, preventing it from being overridden at any subsequent level.' },
  { name: '%undef', doc: 'Undefines a configuration variable, removing its value.' },
  { name: '%define', doc: 'Defines a macro name (flag) without a value. Used with %ifdef/%ifndef.' },
  { name: '%level', doc: 'Sets the processing level for subsequent configuration. Levels: 0=System, 1=Application, 2=Organization, 3=WorkSpace, 4=WorkSet, 5=Role, 6=User.' },
  { name: '%error', doc: 'Emits an error message and halts configuration processing.' },
  { name: '%warning', doc: 'Emits a warning message during configuration processing.' },
];

const OPERATORS = [
  { op: '=', doc: 'Assign variable at current level, overriding any previous value.' },
  { op: '>', doc: 'Append value to existing variable, separated by semicolons (path append).' },
  { op: '<', doc: 'Prepend value to existing variable, separated by semicolons (path prepend).' },
  { op: ':', doc: 'Assign variable only if it is not already defined (default/fallback assignment).' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Completion Provider
// ─────────────────────────────────────────────────────────────────────────────

class BentleyCfgCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);
    const items: vscode.CompletionItem[] = [];

    // ── Inside a $(...) or ${...} variable reference ──
    const varRefMatch = prefix.match(/\$[({]([A-Za-z_]*)$/);
    if (varRefMatch) {
      return this.variableReferenceCompletions(varRefMatch[1]);
    }

    // ── At the start of a line: directive completions ──
    if (/^\s*%[A-Za-z]*$/.test(prefix)) {
      return this.directiveCompletions();
    }

    // ── After %level ──
    if (/^\s*%level\s+\S*$/.test(prefix)) {
      return this.levelCompletions();
    }

    // ── At the start of a line: variable name completions ──
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*$/.test(prefix.trimStart())) {
      for (const v of CFG_VARIABLES) {
        const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
        item.detail = `[${v.category.toUpperCase()}] Configuration Variable`;
        item.documentation = new vscode.MarkdownString(
          `**${v.name}**\n\n${v.documentation}${v.example ? `\n\n*Example:*\n\`\`\`\n${v.example}\n\`\`\`` : ''}`
        );
        item.insertText = new vscode.SnippetString(`${v.name} = \${1:${v.valueHint || 'value'}}`);
        items.push(item);
      }
      return items;
    }

    // ── After `=`, `>`, `<`, `:`: suggest $() references ──
    if (/[=><:]\s*\$?[({]?[A-Za-z_]*$/.test(prefix)) {
      return this.variableReferenceCompletions('');
    }

    // ── Inside $(…): suggest built-in functions ──
    if (/\$\([A-Za-z_]*$/.test(prefix)) {
      return this.builtinFunctionCompletions();
    }

    return items;
  }

  private builtinFunctionCompletions(): vscode.CompletionItem[] {
    return Object.entries(BUILTIN_FUNCTIONS).map(([name, doc]) => {
      const item = new vscode.CompletionItem(name.toUpperCase(), vscode.CompletionItemKind.Function);
      item.detail = 'Built-in CFG Function';
      item.documentation = new vscode.MarkdownString(doc);
      item.insertText = new vscode.SnippetString(`${name.toUpperCase()}(\${1:VAR_NAME})`);
      return item;
    });
  }

  private variableReferenceCompletions(typed: string): vscode.CompletionItem[] {
    return CFG_VARIABLES
      .filter(v => v.name.toLowerCase().startsWith(typed.toLowerCase()))
      .map(v => {
        const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
        item.detail = `[${v.category.toUpperCase()}] ${v.documentation.substring(0, 60)}...`;
        item.documentation = new vscode.MarkdownString(`**${v.name}**\n\n${v.documentation}`);
        item.filterText = v.name;
        return item;
      });
  }

  private directiveCompletions(): vscode.CompletionItem[] {
    return DIRECTIVES.map(d => {
      const item = new vscode.CompletionItem(d.name, vscode.CompletionItemKind.Keyword);
      item.detail = 'Preprocessor Directive';
      item.documentation = new vscode.MarkdownString(d.doc);
      return item;
    });
  }

  private levelCompletions(): vscode.CompletionItem[] {
    const levels = [
      { label: '0', detail: 'System' },
      { label: '1', detail: 'Application' },
      { label: '2', detail: 'Organization' },
      { label: '3', detail: 'WorkSpace' },
      { label: '4', detail: 'WorkSet' },
      { label: '5', detail: 'Role' },
      { label: '6', detail: 'User' },
      { label: 'WorkSpace', detail: 'Level 3' },
      { label: 'WorkSet', detail: 'Level 4' },
      { label: 'Organization', detail: 'Level 2' },
      { label: 'System', detail: 'Level 0' },
      { label: 'Application', detail: 'Level 1' },
      { label: 'Role', detail: 'Level 5' },
      { label: 'User', detail: 'Level 6' },
    ];
    return levels.map(l => {
      const item = new vscode.CompletionItem(l.label, vscode.CompletionItemKind.EnumMember);
      item.detail = l.detail;
      return item;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover Provider
// ─────────────────────────────────────────────────────────────────────────────

class BentleyCfgHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) return null;

    const word = document.getText(range);
    const lineText = document.lineAt(position).text;

    // Check for directive (% prefix on the line)
    const directiveMatch = lineText.match(/^\s*(%\w+)/);
    if (directiveMatch) {
      const directive = DIRECTIVES.find(d => d.name === directiveMatch[1]);
      if (directive) {
        return new vscode.Hover(new vscode.MarkdownString(`**${directive.name}** — Preprocessor Directive\n\n${directive.doc}`));
      }
    }

    // Check for built-in function (Keywords4)
    const funcDoc = BUILTIN_FUNCTIONS[word.toLowerCase()];
    if (funcDoc) {
      return new vscode.Hover(new vscode.MarkdownString(funcDoc), range);
    }

    // Check for known variable
    const variable = CFG_VARIABLES.find(v => v.name === word);
    if (variable) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${variable.name}**\n\n`);
      md.appendMarkdown(`*Category: ${variable.category.toUpperCase()}*\n\n`);
      md.appendMarkdown(variable.documentation);
      if (variable.example) {
        md.appendMarkdown(`\n\n**Example:**\n`);
        md.appendCodeblock(variable.example, 'bentley-cfg');
      }
      if (variable.valueHint) {
        md.appendMarkdown(`\n\n**Value:** \`${variable.valueHint}\``);
      }
      return new vscode.Hover(md, range);
    }

    // Check for operator
    if (['=', '>', '<', ':'].includes(word) || lineText.includes(` ${word} `)) {
      const opInfo = OPERATORS.find(o => o.op === word);
      if (opInfo) {
        return new vscode.Hover(new vscode.MarkdownString(`**\`${opInfo.op}\`** — Assignment Operator\n\n${opInfo.doc}`), range);
      }
    }

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic / Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateCfgDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = document.getText().split('\n');
  const ifStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/#.*$/, '').trimEnd(); // strip comments

    if (!line.trim()) continue;

    // Track %if/%endif nesting
    if (/^\s*%if(?:def|ndef)?\b/.test(line)) {
      ifStack.push(i);
    } else if (/^\s*%endif\b/.test(line)) {
      if (ifStack.length === 0) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, 0, i, rawLine.length),
          '%endif without matching %if / %ifdef / %ifndef',
          vscode.DiagnosticSeverity.Error
        ));
      } else {
        ifStack.pop();
      }
    }

    // Check variable assignment: missing trailing slash on directory paths
    const assignMatch = line.match(/^([A-Za-z_]\w*)\s*[=><:]\s*(.+)$/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const value = assignMatch[2].trim();

      // Directory variables should end with /
      const dirVariables = ['MS_RFDIR', 'MS_CELLLIST', 'MS_DGNLIB', 'MS_PLOTFILES',
        'MS_PLTCFG', 'MS_MDLAPPS', 'MS_MACROS', 'MS_PATTERN', 'MS_GUIDATA',
        'MS_PRINT', 'MS_PRINT_ORGANIZER', 'MS_OUTPUT', 'MS_BACKUP', 'MS_MATERIAL',
        'MS_RENDERDATA', '_USTN_WORKSPACEROOT', '_USTN_WORKSPACESTANDARDS',
        '_USTN_WORKSETSROOT', '_USTN_WORKSETROOT', '_USTN_WORKSETSTANDARDS',
        '_USTN_WORKSETDATA', '_USTN_ORGANIZATION', '_USTN_CONFIGURATION',
        '_USTN_CUSTOM_CONFIGURATION', '_USTN_WORKSPACESROOT'];

      if (dirVariables.includes(varName)) {
        // Value doesn't end with / or ) (variable ref) or * (wildcard)
        const strippedValue = value.replace(/#.*$/, '').trim();
        if (strippedValue && !strippedValue.endsWith('/') && !strippedValue.endsWith(')') && !strippedValue.endsWith('*')) {
          diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(i, 0, i, rawLine.length),
            `Directory variable '${varName}' should end with a trailing slash '/'`,
            vscode.DiagnosticSeverity.Warning
          ));
        }
      }
    }

    // Check for Windows-style backslashes — but NOT in PW paths (@: paths use backslashes legitimately in DMWF)
    // Only flag local absolute paths like C:\ that could cause issues
    if (/[A-Za-z]:\\/.test(line) && !/^\s*#/.test(line) && !line.includes('@:') && !line.includes('_DYNAMIC_LOCAL_ROOT')) {
      const col = line.search(/[A-Za-z]:\\/);
      if (col >= 0) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, col, i, col + 3),
          'Hardcoded local Windows path detected. Consider using forward slashes (/) or a variable-based path for portability.',
          vscode.DiagnosticSeverity.Information
        ));
      }
    }

    // Check for spaces in variable names
    const badVarAssign = rawLine.match(/^([A-Za-z_]\w*\s{2,})[=><:]/);
    if (badVarAssign) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(i, 0, i, rawLine.length),
        'Unexpected whitespace before assignment operator',
        vscode.DiagnosticSeverity.Information
      ));
    }
  }

  // Unclosed %if blocks
  for (const lineNum of ifStack) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(lineNum, 0, lineNum, lines[lineNum].length),
      'Unclosed %if / %ifdef / %ifndef block — missing %endif',
      vscode.DiagnosticSeverity.Error
    ));
  }

  collection.set(document.uri, diagnostics);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Activation
// ─────────────────────────────────────────────────────────────────────────────

import { parseWorkspace, compareWorkspaces, ParseResult } from './cfgParser';
import { ProjectWiseClient, SavedConnection } from './pwClient';
import { WorkspaceExplorerPanel } from './workspaceExplorer';
import {
  extractManagedWorkspace,
  parseManualCsbInput,
  csbToCfgContent,
  listPwApplications,
  getApplicationForFolder,
  CSB_PROCESSING_ORDER,
  CSB_LEVEL_MAP,
  CsbLevel,
} from './csbExtractor';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// In-memory store of the last two loaded parse results for comparison
let lastParseResults: Array<{ label: string; result: ParseResult; rootPath: string }> = [];

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'bentley-cfg' };

  // ── Language features ──────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new BentleyCfgCompletionProvider(),
      '$', '(', '{', '%', '_', 'M', 'C'
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new BentleyCfgHoverProvider())
  );

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('bentley-cfg');
  context.subscriptions.push(diagnosticCollection);

  const validate = (doc: vscode.TextDocument) => {
    if (doc.languageId === 'bentley-cfg') validateCfgDocument(doc, diagnosticCollection);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(validate));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(validate));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => validate(e.document)));
  vscode.workspace.textDocuments.forEach(validate);

  // ── Simple validation command ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.validateFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        validateCfgDocument(editor.document, diagnosticCollection);
        vscode.window.showInformationMessage('Bentley CFG: Validation complete.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.insertVariable', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const picked = await vscode.window.showQuickPick(
        CFG_VARIABLES.map(v => ({
          label: v.name,
          description: `[${v.category.toUpperCase()}]`,
          detail: v.documentation.substring(0, 80),
        })),
        { placeHolder: 'Select a variable to insert' }
      );
      if (picked) editor.insertSnippet(new vscode.SnippetString(`$\{(${picked.label})\}`));
    })
  );

  // ── Workspace Explorer ────────────────────────────────────────────────────

  /**
   * Load a local workspace from the file system
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadLocalWorkspace', async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Select Workspace Root Folder',
        title: 'Load Bentley Local Workspace',
      });
      if (!folder || folder.length === 0) return;

      const rootPath = folder[0].fsPath;
      const label = path.basename(rootPath);

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Loading workspace: ${label}...`);

      const workspaceName = await vscode.window.showInputBox({
        prompt: 'WorkSpace name (optional — for variable seeding)',
        placeHolder: 'e.g. MyClient',
      });
      const worksetName = await vscode.window.showInputBox({
        prompt: 'WorkSet name (optional)',
        placeHolder: 'e.g. ProjectABC',
      });

      try {
        const result = await runParseInBackground(rootPath, {}, workspaceName, worksetName);
        storeResult({ label, result, rootPath });
        panel.showParseResult(result, label, rootPath);
        vscode.window.showInformationMessage(
          `Workspace loaded: ${result.variables.size} variables, ${result.filesProcessed.length} files, ${result.errors.length} issues.`
        );
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to load workspace: ${e}`);
      }
    })
  );

  /**
   * Load a workspace from a single CFG file (single-file view)
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bentley-cfg') {
        vscode.window.showWarningMessage('Open a .cfg file first.');
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const label = path.basename(filePath);
      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Resolving: ${label}...`);
      try {
        const result = await runParseInBackground(filePath);
        storeResult({ label, result, rootPath: filePath });
        panel.showParseResult(result, label, filePath);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to parse file: ${e}`);
      }
    })
  );

  /**
   * Load a Managed Workspace from ProjectWise via WSG API
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadProjectWiseWorkspace', async () => {
      // Load saved connections
      const saved: SavedConnection[] = context.globalState.get('pw.connections', []);

      // Choose or create connection
      const items: vscode.QuickPickItem[] = [
        { label: '$(add) New ProjectWise connection...', description: '' },
        ...saved.map(c => ({
          label: `$(server) ${c.label}`,
          description: `${c.wsgUrl} / ${c.datasource}`,
          detail: c.id,
        })),
      ];

      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a ProjectWise connection',
        title: 'Load Managed Workspace from ProjectWise',
      });
      if (!chosen) return;

      let conn: SavedConnection;
      if (chosen.label.includes('New ProjectWise connection')) {
        const newConn = await promptNewConnection();
        if (!newConn) return;
        conn = newConn;
        // Save it
        saved.push(conn);
        await context.globalState.update('pw.connections', saved);
      } else {
        conn = saved.find(c => c.id === chosen.detail)!;
        if (!conn) return;
      }

      // Get password from SecretStorage
      let password = await context.secrets.get(`pw.pass.${conn.id}`);
      if (!password) {
        password = await vscode.window.showInputBox({
          prompt: `Password for ${conn.username}@${conn.wsgUrl}`,
          password: true,
        });
        if (!password) return;
        await context.secrets.store(`pw.pass.${conn.id}`, password);
      }

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Connecting to ProjectWise: ${conn.label}...`);

      try {
        const client = new ProjectWiseClient({
          wsgUrl: conn.wsgUrl,
          datasource: conn.datasource,
          username: conn.username,
          credential: password,
          authType: conn.authType,
          ignoreSsl: conn.ignoreSsl,
        });

        const pwConn = {
          wsgUrl: conn.wsgUrl,
          datasource: conn.datasource,
          username: conn.username,
          credential: password,
          authType: conn.authType,
          ignoreSsl: conn.ignoreSsl,
        };

        // ── Step 1: Pick a PW Application (mirrors PWE's starting point) ─────
        // CSBs are assigned to the Application, not to folders. The Application
        // determines which Managed Workspace Profile (and therefore which CSBs)
        // are used — exactly as PWE resolves this when a document is opened.
        panel.showLoading('Fetching Applications from ProjectWise...');
        const applications = await listPwApplications(client);

        let applicationInstanceId: string | undefined;
        let folderGuid: string | undefined;
        let label = `PW: ${conn.label}`;

        if (applications.length > 0) {
          // Application list available — user picks the Application first
          const appItems = applications.map(a => ({
            label: `$(beaker) ${a.name}`,
            description: a.managedWorkspaceProfileName
              ? `Managed Workspace: ${a.managedWorkspaceProfileName}`
              : a.description,
            detail: a.instanceId,
          }));
          appItems.push({
            label: '$(folder) Browse by folder instead...',
            description: 'Pick a PW folder (if Application list is unavailable)',
            detail: '__browse_folder__',
          });

          const appPick = await vscode.window.showQuickPick(appItems, {
            placeHolder: 'Select a ProjectWise Application to resolve its Managed Workspace',
            title: 'Load Managed Workspace from ProjectWise',
          });
          if (!appPick) return;

          if (appPick.detail !== '__browse_folder__') {
            applicationInstanceId = appPick.detail!;
            label = `PW: ${conn.label} / ${applications.find(a => a.instanceId === applicationInstanceId)?.name ?? applicationInstanceId}`;
          }
        }

        // If no applications found (or user chose folder browse), pick a folder
        if (!applicationInstanceId) {
          panel.showLoading('Fetching folder list from ProjectWise...');
          const projects = await client.listProjects();
          const folderItems = projects.map(p => ({
            label: `$(folder) ${p.name}`,
            description: p.description,
            detail: p.instanceId,
          }));
          const folderPick = await vscode.window.showQuickPick(folderItems, {
            placeHolder: 'Select the document folder to resolve WorkSet CSBs',
            title: 'Select PW Folder',
          });
          if (!folderPick) return;
          folderGuid = folderPick.detail!;
          label = `PW: ${conn.label} / ${projects.find(p => p.instanceId === folderGuid)?.name ?? folderGuid}`;

          // Try to look up the Application from the folder
          panel.showLoading('Resolving Application assignment from folder...');
          const app = await getApplicationForFolder(client, folderGuid);
          if (app) {
            applicationInstanceId = app.instanceId;
            vscode.window.showInformationMessage(
              `Resolved Application "${app.name}" from folder. Using its Managed Workspace Profile.`
            );
          }
        }

        // Optionally pick the document folder for WorkSet/Discipline CSBs
        // (only needed if the Application alone doesn't cover WorkSet-level CSBs)
        if (applicationInstanceId && !folderGuid) {
          const wantFolder = await vscode.window.showQuickPick(
            [
              { label: '$(folder) Select a document folder (WorkSet-level CSBs)', detail: 'yes' },
              { label: '$(pass) Application CSBs only', detail: 'no' },
            ],
            { placeHolder: 'Do you want to specify the document folder for WorkSet/Discipline CSBs?' }
          );
          if (wantFolder?.detail === 'yes') {
            panel.showLoading('Fetching folder list...');
            const projects = await client.listProjects();
            const folderItems = projects.map(p => ({
              label: `$(folder) ${p.name}`,
              description: p.description,
              detail: p.instanceId,
            }));
            const folderPick = await vscode.window.showQuickPick(folderItems, {
              placeHolder: 'Select the document folder',
            });
            if (folderPick) {
              folderGuid = folderPick.detail!;
            }
          }
        }

        // ── Step 2: Extract CSBs and build working directory ──────────────────
        panel.showLoading('Extracting Configuration Settings Blocks (CSBs)...');
        const extraction = await extractManagedWorkspace(pwConn, {
          datasource: conn.datasource,
          applicationInstanceId,
          folderGuid,
        }, client);

        const backendMsg = `Backend: ${extraction.backend} | CSBs: ${extraction.csbs.length}`;
        const warnings = extraction.messages.filter(m => m.level === 'warning' || m.level === 'error');
        if (warnings.length > 0) {
          vscode.window.showWarningMessage(
            `CSB extraction issues (${warnings.length}) — ${backendMsg}`,
            'View Master .tmp'
          ).then(choice => {
            if (choice === 'View Master .tmp') {
              vscode.window.showTextDocument(vscode.Uri.file(extraction.masterTmpPath), { preview: true });
            }
          });
        }

        // ── Step 3: Parse from master .tmp (same as MicroStation -wc argument) ─
        panel.showLoading(`Resolving variables from ${extraction.csbs.length} CSBs...`);
        const result = await runParseInBackground(extraction.masterTmpPath);

        storeResult({ label, result, rootPath: extraction.workDir });
        panel.showParseResult(result, label, extraction.workDir);
        vscode.window.showInformationMessage(
          `PW Managed Workspace loaded: ${extraction.csbs.length} CSBs → ${result.variables.size} variables | ${backendMsg}` +
          (extraction.workspaceName ? ` | Workspace: ${extraction.workspaceName}` : '') +
          (extraction.worksetName ? ` | WorkSet: ${extraction.worksetName}` : '')
        );
      } catch (e) {
        vscode.window.showErrorMessage(`ProjectWise error: ${e}`);
      }
    })
  );

  /**
   * Manage / delete saved PW connections
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.managePwConnections', async () => {
      const saved: SavedConnection[] = context.globalState.get('pw.connections', []);
      if (saved.length === 0) {
        vscode.window.showInformationMessage('No saved ProjectWise connections.');
        return;
      }
      const items = saved.map(c => ({
        label: c.label,
        description: `${c.wsgUrl} / ${c.datasource}`,
        detail: c.id,
      }));
      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select connection to delete',
        title: 'Manage Saved ProjectWise Connections',
      });
      if (!chosen) return;
      const updated = saved.filter(c => c.id !== chosen.detail);
      await context.globalState.update('pw.connections', updated);
      await context.secrets.delete(`pw.pass.${chosen.detail}`);
      vscode.window.showInformationMessage(`Removed connection: ${chosen.label}`);
    })
  );

  /**
   * Compare the two most recently loaded workspaces
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.compareWorkspaces', async () => {
      if (lastParseResults.length < 2) {
        vscode.window.showWarningMessage('Load at least 2 workspaces first (use Load Local or Load ProjectWise Workspace).');
        return;
      }

      // Pick left and right
      const pickItems = lastParseResults.map((r, i) => ({
        label: r.label,
        description: `${r.result.variables.size} vars, ${r.result.filesProcessed.length} files`,
        detail: String(i),
      }));

      const leftPick = await vscode.window.showQuickPick(pickItems, { placeHolder: 'Select LEFT / baseline workspace' });
      if (!leftPick) return;
      const rightPick = await vscode.window.showQuickPick(
        pickItems.filter(p => p.detail !== leftPick.detail),
        { placeHolder: 'Select RIGHT / comparison workspace' }
      );
      if (!rightPick) return;

      const left = lastParseResults[parseInt(leftPick.detail!)];
      const right = lastParseResults[parseInt(rightPick.detail!)];

      const compare = compareWorkspaces(left.result, right.result);
      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showCompareResult(compare, left.label, right.label);

      vscode.window.showInformationMessage(
        `Comparison: +${compare.addedCount} added, -${compare.removedCount} removed, ~${compare.changedCount} changed, =${compare.unchangedCount} same`
      );
    })
  );

  /**
   * Compare two local folders directly (quick path)
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.compareFolders', async () => {
      const leftFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false,
        openLabel: 'Select baseline (LEFT) workspace folder',
      });
      if (!leftFolder) return;
      const rightFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false,
        openLabel: 'Select comparison (RIGHT) workspace folder',
      });
      if (!rightFolder) return;

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading('Parsing and comparing workspaces...');

      const [leftResult, rightResult] = await Promise.all([
        runParseInBackground(leftFolder[0].fsPath),
        runParseInBackground(rightFolder[0].fsPath),
      ]);

      const leftLabel = path.basename(leftFolder[0].fsPath);
      const rightLabel = path.basename(rightFolder[0].fsPath);
      storeResult({ label: leftLabel, result: leftResult, rootPath: leftFolder[0].fsPath });
      storeResult({ label: rightLabel, result: rightResult, rootPath: rightFolder[0].fsPath });

      const compare = compareWorkspaces(leftResult, rightResult);
      panel.showCompareResult(compare, leftLabel, rightLabel);
    })
  );


  /**
   * Manual CSB import — for environments without PW client tools installed
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.importCsbManual', async () => {
      const levelPick = await vscode.window.showQuickPick(
        CSB_PROCESSING_ORDER.map(l => ({ label: l, description: `%level ${CSB_LEVEL_MAP[l]}` })),
        { placeHolder: 'Select CSB processing level', title: 'Manual CSB Import' }
      );
      if (!levelPick) return;

      const name = await vscode.window.showInputBox({
        prompt: 'CSB name (for identification)',
        placeHolder: 'e.g. MSta_CE_Configuration_Root',
      });
      if (!name) return;

      const content = await vscode.window.showInputBox({
        prompt: 'Paste CSB variable content (one assignment per line, e.g.  VAR_NAME = value)',
        placeHolder: '_USTN_CONFIGURATION = C:/PW/Configuration/\nMS_RFDIR > $(MS_DATA)rsc/',
        ignoreFocusOut: true,
      });
      if (content === undefined) return;

      // Write to a temp working dir and parse it
      const workDir = path.join(os.tmpdir(), `pw-manual-csb-${Date.now()}`);
      const wsDir = path.join(workDir, 'workspace');
      fs.mkdirSync(wsDir, { recursive: true });

      const csb = parseManualCsbInput(content, levelPick.label as CsbLevel, name);
      const cfgContent = csbToCfgContent(csb, workDir);
      const cfgPath = path.join(wsDir, `${csb.id}.cfg`);
      fs.writeFileSync(cfgPath, cfgContent, 'utf8');

      // Open the generated CFG so the user can see / edit it
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`CSB "${name}" written as ${path.basename(cfgPath)} — you can now load this folder as a workspace.`);
    })
  );

  /**
   * View the most recently generated master .tmp file
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.viewMasterTmp', async () => {
      const entry = lastParseResults.find(r => r.rootPath.includes('workspace') && r.rootPath.includes('.tmp'));
      const tmpFiles: string[] = [];

      // Search recent result working dirs for .tmp files
      for (const r of lastParseResults) {
        const wsDir = path.join(r.rootPath, 'workspace');
        if (fs.existsSync(wsDir)) {
          const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.tmp'));
          files.forEach(f => tmpFiles.push(path.join(wsDir, f)));
        }
        if (r.rootPath.endsWith('.tmp') && fs.existsSync(r.rootPath)) {
          tmpFiles.push(r.rootPath);
        }
      }

      if (tmpFiles.length === 0) {
        vscode.window.showInformationMessage('No generated master .tmp files found. Load a ProjectWise Managed Workspace first.');
        return;
      }

      const pick = tmpFiles.length === 1
        ? tmpFiles[0]
        : (await vscode.window.showQuickPick(tmpFiles.map(f => ({ label: path.basename(f), detail: f })), {
            placeHolder: 'Select master config file to view',
          }))?.detail;

      if (pick) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pick));
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  console.log('Bentley CFG extension activated');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runParseInBackground(
  rootPath: string,
  envVars: Record<string, string> = {},
  workspaceName?: string,
  worksetName?: string
): Promise<ParseResult> {
  // Run synchronously but wrapped in a promise so VS Code stays responsive
  return new Promise((resolve, reject) => {
    try {
      const result = parseWorkspace(rootPath, envVars, workspaceName || undefined, worksetName || undefined);
      resolve(result);
    } catch (e) {
      reject(e);
    }
  });
}

function storeResult(entry: { label: string; result: ParseResult; rootPath: string }): void {
  // Keep last 5
  lastParseResults = lastParseResults.filter(r => r.rootPath !== entry.rootPath);
  lastParseResults.unshift(entry);
  if (lastParseResults.length > 5) lastParseResults = lastParseResults.slice(0, 5);
}

async function promptNewConnection(): Promise<SavedConnection | null> {
  const label = await vscode.window.showInputBox({ prompt: 'Connection label (e.g. "ACME ProjectWise")', placeHolder: 'My PW Server' });
  if (!label) return null;

  const wsgUrl = await vscode.window.showInputBox({
    prompt: 'WSG Base URL',
    placeHolder: 'https://pw-server.company.com/ws',
    value: 'https://',
  });
  if (!wsgUrl) return null;

  const datasource = await vscode.window.showInputBox({
    prompt: 'Datasource name',
    placeHolder: 'pwdb',
  });
  if (!datasource) return null;

  const username = await vscode.window.showInputBox({ prompt: 'Username' });
  if (!username) return null;

  const authTypePick = await vscode.window.showQuickPick(
    ['Basic (username/password)', 'Bearer token'],
    { placeHolder: 'Authentication type' }
  );
  const authType: 'basic' | 'bearer' = authTypePick?.includes('Bearer') ? 'bearer' : 'basic';

  const sslPick = await vscode.window.showQuickPick(
    ['Verify SSL certificate (recommended)', 'Ignore SSL errors (self-signed cert)'],
    { placeHolder: 'SSL verification' }
  );
  const ignoreSsl = sslPick?.includes('Ignore') ?? false;

  return {
    id: `pw-${Date.now()}`,
    label,
    wsgUrl,
    datasource,
    username,
    authType,
    ignoreSsl,
  };
}

export function deactivate(): void {}
