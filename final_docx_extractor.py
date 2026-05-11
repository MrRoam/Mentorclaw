#!/usr/bin/env python3
"""Extract docx heading information - standalone script"""

import json
import sys
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

def extract_headings_from_docx_structure(file_path):
    """Extract headings by parsing document.xml structure in DOCX (ZIP)"""
    headings = []
    try:
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            # Read document.xml
            xml_content = zip_ref.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # Define namespaces
            namespaces = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
            }
            
            # Find all paragraphs
            for para in root.findall('.//w:p', namespaces):
                # Get style
                pStyle = para.find('.//w:pStyle', namespaces)
                if pStyle is not None:
                    style_val = pStyle.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
                    
                    # Check if it's a heading style
                    if style_val and style_val.startswith('Heading'):
                        # Extract heading level
                        try:
                            level = int(''.join(filter(str.isdigit, style_val)))
                        except:
                            level = 0
                        
                        # Extract text
                        text_parts = []
                        for text_elem in para.findall('.//w:t', namespaces):
                            if text_elem.text:
                                text_parts.append(text_elem.text)
                        text = ''.join(text_parts).strip()
                        
                        if text:
                            headings.append({
                                "level": level,
                                "text": text
                            })
        
        return headings
    except Exception as e:
        return None

def extract_headings_python_docx(file_path):
    """Extract headings using python-docx"""
    try:
        from docx import Document
        doc = Document(str(file_path))
        headings = []
        
        for para in doc.paragraphs:
            style_name = para.style.name
            if style_name.startswith('Heading'):
                try:
                    level = int(style_name.split()[-1])
                except:
                    level = int(''.join(filter(str.isdigit, style_name)) or '0')
                
                if para.text.strip():
                    headings.append({
                        "level": level,
                        "text": para.text.strip()
                    })
        
        return headings
    except ImportError:
        return None
    except Exception:
        return None

def main():
    target_path = Path("D:/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文")
    
    result = {
        "path_checks": {
            "windows": {
                "path": r"D:\Desktop\Obsidian\北航\冯如杯\冯如杯资料\范文",
                "accessible": target_path.exists() and target_path.is_dir()
            },
            "wsl": {
                "path": "/mnt/d/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文",
                "accessible": False
            }
        },
        "docx_files": [],
        "sampled_files": []
    }
    
    if target_path.exists() and target_path.is_dir():
        # List all .docx files
        docx_files = sorted([f.name for f in target_path.glob("*.docx") if not f.name.startswith("~$")])
        result["docx_files"] = docx_files
        
        # Process first 3 files
        for filename in docx_files[:3]:
            file_path = target_path / filename
            sample_result = {
                "filename": filename,
                "method": None,
                "headings": []
            }
            
            # Try python-docx first
            headings = extract_headings_python_docx(file_path)
            if headings is not None:
                sample_result["method"] = "python-docx"
                sample_result["headings"] = headings
            else:
                # Fallback to ZIP structure parsing
                headings = extract_headings_from_docx_structure(file_path)
                if headings is not None:
                    sample_result["method"] = "docx_xml_structure"
                    sample_result["headings"] = headings
                else:
                    sample_result["method"] = "unavailable"
            
            result["sampled_files"].append(sample_result)
    
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
